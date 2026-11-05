/**
 * Motivo de negado registrado (columna "Motivo de negado" del Rpt_OrdenesPreparacion).
 * Mismo cálculo que tenía /radar/ (4 nov 2026):
 * - Pedido + Código una sola vez, estado A, negado = cantidad preparada ≤ 0, día = Fecha Actualizado
 *   (o Fecha Enviado Revisión si falta).
 * - Se calcula con el archivo completo, no solo con las líneas nuevas. Un archivo reemplaza el día solo si
 *   trae igual o más negadas de ese día (un archivo más viejo o parcial no lo baja). Cargar dos veces no duplica.
 * - Motivo vacío = "" ("Sin motivo").
 */
import { ymd } from '../comun/fechas';
import { dedupRecords } from './dedup';
import type { Historial, MotivosDia, Registro, DiaResumen } from './tipos';

export const MOT_COL: Record<string, string> = {
  'Existencia a cero': '#3A76B0', 'Sin existencia ubicación picking': '#86AED6', 'Físico no se encuentra': '#DE7A2C',
  'Producto incompleto o averiado': '#8E6BB5', 'Pasillo bloqueado': '#4E9A55', '': '#A39C90',
};
const MOT_ORD = ['Físico no se encuentra', 'Existencia a cero', 'Sin existencia ubicación picking', 'Producto incompleto o averiado', 'Pasillo bloqueado'];

/** Negados que no cuentan en el fill rate: no había producto en el CD. ("Sin existencia ubicación picking" sí cuenta: hay en tarimas.) */
export const EXIST_CERO = 'Existencia a cero';

export const motClean = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
export const motLabel = (k: string): string => (k === '' ? 'Sin motivo' : k);
export const motColor = (k: string): string => MOT_COL[k] || '#6F685C';
const rango = (k: string) => (k === '' ? 99 : MOT_ORD.indexOf(k) + 1 || 50);
export const motSort = (a: string, b: string): number => rango(a) - rango(b) || (a < b ? -1 : a > b ? 1 : 0);

/** Motivos por día del archivo completo. Vacío si el archivo no trae la columna. */
export function motivosDeRegistros(records: Registro[]): Record<string, MotivosDia> {
  if (!records.some((r) => 'Motivo' in r)) return {};
  const { rows } = dedupRecords(records);
  const tmp: Record<string, { n: number; m: Record<string, number>; q: Record<string, Record<string, Record<string, number>>> }> = {};
  const dia = (d: string) => tmp[d] || (tmp[d] = { n: 0, m: {}, q: {} });
  // B2B: pedido corporativo cerrado (todas sus líneas en A) en el día de su última línea; cumple si todo se mandó
  // completo, sin contar lo negado por "Existencia a cero". Un pedido negado entero por existencia a cero no cuenta.
  const b2bPed = new Set(records.filter((r) => /CORPORATIVA/i.test(String(r.Razon || ''))).map((r) => r.Pedido));
  const ped = new Map<string, { abierto: boolean; dia: string; lineas: number; ok: boolean }>();
  for (const r of rows) {
    if (!b2bPed.has(r.Pedido)) continue;
    const p = ped.get(r.Pedido) || { abierto: false, dia: '', lineas: 0, ok: true };
    ped.set(r.Pedido, p);
    const fin = r.FechaAct || r.FechaRevision;
    if (r.Estado !== 'A' || r.CantPrep == null || r.Cantidad == null || !fin) { p.abierto = true; continue; }
    const d = ymd(fin);
    if (d > p.dia) p.dia = d;
    if (r.CantPrep <= 0 && motClean(r.Motivo) === EXIST_CERO) continue;
    p.lineas++;
    if (!(r.CantPrep >= r.Cantidad)) p.ok = false;
  }
  const b2b: Record<string, [number, number]> = {};
  ped.forEach((p) => {
    if (p.abierto || !p.lineas) return;
    const b = b2b[p.dia] || (b2b[p.dia] = [0, 0]);
    b[0]++; if (p.ok) b[1]++;
  });
  for (const r of rows) {
    if (r.Estado !== 'A' || r.CantPrep == null || r.Cantidad == null || r.Disponible == null) continue;
    if (!(r.CantPrep <= 0)) continue;
    const fin = r.FechaAct || r.FechaRevision;
    if (!fin) continue;
    const day = ymd(fin), o = dia(day), mot = motClean(r.Motivo);
    o.n++;
    o.m[mot] = (o.m[mot] || 0) + 1;
    const pq = o.q[r.Preparador] || (o.q[r.Preparador] = {}), c = pq[r.SKU] || (pq[r.SKU] = {});
    c[mot] = (c[mot] || 0) + 1;
  }
  for (const d in b2b) dia(d);
  // compacto: los motivos van en una lista y por código solo los conteos en ese orden
  const out: Record<string, MotivosDia> = {};
  for (const d in tmp) {
    const o = tmp[d], k = Object.keys(o.m).sort(motSort), ix: Record<string, number> = {};
    k.forEach((x, i) => { ix[x] = i; });
    const q: MotivosDia['q'] = {};
    for (const pr in o.q) {
      q[pr] = {};
      for (const sku in o.q[pr]) {
        const a: number[] = [];
        for (const x in o.q[pr][sku]) a[ix[x]] = o.q[pr][sku][x];
        for (let i = 0; i < a.length; i++) if (a[i] == null) a[i] = 0;
        q[pr][sku] = a;
      }
    }
    out[d] = { n: o.n, m: o.m, k, q };
    if (b2b[d]) out[d].b = b2b[d];
  }
  return out;
}

/** Pone los motivos en los días del histórico. Devuelve los días que cambiaron. */
export function aplicarMotivos(history: Historial, porDia: Record<string, MotivosDia>): string[] {
  const cambiados: string[] = [];
  for (const d in porDia) {
    const h = history[d] as DiaResumen | undefined;
    if (!h || h.v !== 2) continue;
    // un archivo más viejo o parcial no baja el día: menos negadas, o las mismas con menos pedidos B2B
    if (h.mot && (h.mot.n > porDia[d].n || (h.mot.n === porDia[d].n && (h.mot.b?.[0] || 0) > (porDia[d].b?.[0] || 0)))) continue;
    if (h.mot && JSON.stringify(h.mot) === JSON.stringify(porDia[d])) continue;
    h.mot = porDia[d];
    cambiados.push(d);
  }
  return cambiados;
}

/** Motivos de un preparador en unos días: código -> {motivo: veces}. null si ningún día trae motivos. */
export function motivosDePreparador(history: Historial, dias: string[], raw: string): Record<string, Record<string, number>> | null {
  const out: Record<string, Record<string, number>> = {};
  let con = false;
  for (const d of dias) {
    const mo = (history[d] as DiaResumen | undefined)?.mot;
    if (!mo || !mo.q || !mo.k) continue;
    con = true;
    const pq = mo.q[raw];
    if (!pq) continue;
    for (const sku in pq) {
      const t = out[sku] || (out[sku] = {});
      pq[sku].forEach((v, i) => { if (v) t[mo.k[i]] = (t[mo.k[i]] || 0) + v; });
    }
  }
  return con ? out : null;
}

/** Negadas del día que no cuentan en el fill rate: "Existencia a cero" registrada; si el día no trae motivo, las de disponible 0 o negativo. */
export function exclusionDia(h: DiaResumen | undefined): number {
  if (!h || h.v !== 2 || !h.meta) return 0;
  const neg = h.meta.totalNegados || 0;
  if (h.mot) return Math.min(h.mot.m[EXIST_CERO] || 0, neg);
  return Math.min((h.bucket?.cero || 0) + (h.bucket?.negativo || 0), neg);
}

/** Fill rate del CD en unos días: preparadas ÷ (preparadas + negadas que sí se podían preparar). */
export function fillRateCD(history: Historial, dias: string[]): { prep: number; neg: number; excl: number; base: number; pct: number | null } {
  let prep = 0, neg = 0, excl = 0;
  for (const d of dias) {
    const h = history[d] as DiaResumen | undefined;
    if (!h || !h.meta) continue;
    const t = h.meta.totalFinal || 0, n = h.meta.totalNegados || 0;
    prep += h.meta.totalPreparados != null ? h.meta.totalPreparados : Math.max(t - n, 0);
    neg += n;
    excl += exclusionDia(h);
  }
  const base = prep + neg - excl;
  return { prep, neg, excl, base, pct: base ? (prep / base) * 100 : null };
}

/** Negadas por "Existencia a cero" de cada preparador en unos días (solo días con motivo registrado). */
export function exclusionPorPreparador(history: Historial, dias: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dias) {
    const mo = (history[d] as DiaResumen | undefined)?.mot;
    if (!mo || !mo.q || !mo.k) continue;
    const i = mo.k.indexOf(EXIST_CERO);
    if (i < 0) continue;
    for (const pr in mo.q) for (const sku in mo.q[pr]) { const v = mo.q[pr][sku][i] || 0; if (v) out[pr] = (out[pr] || 0) + v; }
  }
  return out;
}

/**
 * Negadas de unos días partidas como el fill rate: "sin stock" = "Existencia a cero" (en días sin motivo registrado,
 * disponible 0 o negativo) y "error en el proceso" = el resto (sí había producto en el CD). Además, los motivos registrados.
 */
export function negadosPorMotivo(history: Historial, dias: string[]) {
  let neg = 0, sinStock = 0, diasMot = 0, negMot = 0, cero = 0, negativo = 0;
  const m: Record<string, number> = {};
  for (const d of dias) {
    const h = history[d] as DiaResumen | undefined;
    if (!h || h.v !== 2 || !h.meta) continue;
    neg += h.meta.totalNegados || 0;
    sinStock += exclusionDia(h);
    if (h.mot) {
      diasMot++; negMot += h.mot.n;
      for (const k in h.mot.m) m[k] = (m[k] || 0) + h.mot.m[k];
    } else { cero += h.bucket?.cero || 0; negativo += h.bucket?.negativo || 0; }
  }
  return { neg, sinStock, error: Math.max(0, neg - sinStock), m, diasMot, negMot, cero, negativo };
}

/** Veces negado de cada código por motivo registrado en unos días (suma de todos los preparadores). */
export function motivosPorCodigo(history: Historial, dias: string[]): Record<string, Record<string, number>> | null {
  const out: Record<string, Record<string, number>> = {};
  let con = false;
  for (const d of dias) {
    const mo = (history[d] as DiaResumen | undefined)?.mot;
    if (!mo || !mo.q || !mo.k) continue;
    con = true;
    for (const pr in mo.q) for (const sku in mo.q[pr]) {
      const t = out[sku] || (out[sku] = {});
      mo.q[pr][sku].forEach((v, i) => { if (v) t[mo.k[i]] = (t[mo.k[i]] || 0) + v; });
    }
  }
  return con ? out : null;
}
