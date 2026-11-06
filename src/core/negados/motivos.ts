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
  'Existencia a cero': '#1E3A6E', 'Sin existencia ubicación picking': '#8A9BB8', 'Físico no se encuentra': '#E0262B',
  'Producto incompleto o averiado': '#1A1A1A', 'Pasillo bloqueado': '#6D6E70', '': '#C4C6C9',
};
const MOT_ORD = ['Físico no se encuentra', 'Existencia a cero', 'Sin existencia ubicación picking', 'Producto incompleto o averiado', 'Pasillo bloqueado'];

/** Negados que no cuentan en el fill rate: no había producto en el CD. ("Sin existencia ubicación picking" sí cuenta: hay en tarimas.) */
export const EXIST_CERO = 'Existencia a cero';

export const motClean = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
export const motLabel = (k: string): string => (k === '' ? 'Sin motivo' : k);
export const motColor = (k: string): string => MOT_COL[k] || '#6F685C';
const rango = (k: string) => (k === '' ? 99 : MOT_ORD.indexOf(k) + 1 || 50);
export const motSort = (a: string, b: string): number => rango(a) - rango(b) || (a < b ? -1 : a > b ? 1 : 0);

/** Línea negada de un día: motivo, preparador y código (la clave es pedido|código). */
type LineaMot = { mot: string; prep: string; sku: string };

/**
 * Arma el resumen del día desde sus líneas negadas y sus pedidos B2B. Guarda también las líneas (l, p) y los
 * pedidos B2B (bp) para poder juntar archivos después sin contar dos veces.
 */
const pedidoDe = (key: string) => key.slice(0, key.lastIndexOf('|'));

function armarDia(lineas: Map<string, LineaMot>, bp: Record<string, number>, zp: Record<string, 1> = {}, bp2: Record<string, number> = {}): MotivosDia {
  const m: Record<string, number> = {};
  lineas.forEach((x) => { m[x.mot] = (m[x.mot] || 0) + 1; });
  const k = Object.keys(m).sort(motSort), ix: Record<string, number> = {};
  k.forEach((x, i) => { ix[x] = i; });
  const p: string[] = [], px: Record<string, number> = {};
  const q: MotivosDia['q'] = {}, l: Record<string, [number, number]> = {};
  lineas.forEach((x, key) => {
    if (!(x.prep in px)) { px[x.prep] = p.length; p.push(x.prep); }
    l[key] = [ix[x.mot], px[x.prep]];
    const pq = q[x.prep] || (q[x.prep] = {}), a = pq[x.sku] || (pq[x.sku] = []);
    for (let i = a.length; i < k.length; i++) a[i] = 0;
    a[ix[x.mot]]++;
  });
  // recorta ceros al final, como antes
  for (const pr in q) for (const sku in q[pr]) { const a = q[pr][sku]; while (a.length && !a[a.length - 1]) a.pop(); }
  const out: MotivosDia = { n: lineas.size, m, k, q, l, p };
  const peds = Object.keys(bp);
  if (peds.length) { out.b = [peds.length, peds.reduce((a, x) => a + (bp[x] ? 1 : 0), 0)]; out.bp = bp; }
  if (Object.keys(zp).length) {
    out.zp = zp;
    let z = 0; lineas.forEach((_, key) => { if (zp[pedidoDe(key)]) z++; });
    out.z = z;
  }
  const p2 = Object.keys(bp2);
  if (p2.length) { out.b2 = [p2.length, p2.reduce((a, x) => a + (bp2[x] ? 1 : 0), 0)]; out.bp2 = bp2; }
  return out;
}

/** Líneas guardadas de un día (para juntarlas con las de otro archivo). null si el día se guardó sin líneas. */
function lineasDe(mo: MotivosDia): Map<string, LineaMot> | null {
  if (!mo.l || !mo.p) return null;
  const L = new Map<string, LineaMot>();
  for (const key in mo.l) { const [mi, pi] = mo.l[key]; L.set(key, { mot: mo.k[mi], prep: mo.p[pi], sku: key.slice(key.lastIndexOf('|') + 1) }); }
  return L;
}

/** Motivos por día del archivo completo. Vacío si el archivo no trae la columna. */
export function motivosDeRegistros(records: Registro[]): Record<string, MotivosDia> {
  if (!records.some((r) => 'Motivo' in r)) return {};
  const { rows } = dedupRecords(records);
  const L: Record<string, Map<string, LineaMot>> = {}, BP: Record<string, Record<string, number>> = {};
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
  ped.forEach((p, id) => {
    if (p.abierto || !p.lineas) return;
    (BP[p.dia] || (BP[p.dia] = {}))[id] = p.ok ? 1 : 0;
  });
  // Pedidos "en cero": todas sus líneas cerradas (A) y ninguna preparada. Es lo que el sistema pone en cero
  // automático; no cuentan en el fill rate (como el corporativo). Un pedido con líneas abiertas todavía no se sabe.
  const tp = new Map<string, { abierto: boolean; prep: boolean; lineas: number; dia: string; ok: boolean }>();
  for (const r of rows) {
    const t = tp.get(r.Pedido) || { abierto: false, prep: false, lineas: 0, dia: '', ok: true };
    tp.set(r.Pedido, t);
    const fin = r.FechaAct || r.FechaRevision;
    if (r.Estado !== 'A' || r.CantPrep == null || r.Cantidad == null || !fin) { t.abierto = true; continue; }
    t.lineas++;
    if (r.CantPrep > 0) t.prep = true;
    if (!(r.CantPrep >= r.Cantidad)) t.ok = false;
    const d = ymd(fin);
    if (d > t.dia) t.dia = d;
  }
  const enCero = new Set<string>(), nz: string[] = [], BP2: Record<string, Record<string, number>> = {};
  tp.forEach((t, id) => {
    if (!t.abierto && t.lineas && !t.prep) enCero.add(id); else nz.push(id);
    // B2B (regla 6 nov): pedido corporativo cerrado que no está en cero; cumple si todas sus líneas fueron completas
    if (b2bPed.has(id) && !t.abierto && t.lineas && t.prep) (BP2[t.dia] || (BP2[t.dia] = {}))[id] = t.ok ? 1 : 0;
  });
  for (const r of rows) {
    if (r.Estado !== 'A' || r.CantPrep == null || r.Cantidad == null || r.Disponible == null) continue;
    if (!(r.CantPrep <= 0)) continue;
    const fin = r.FechaAct || r.FechaRevision;
    if (!fin) continue;
    const d = ymd(fin);
    (L[d] || (L[d] = new Map())).set(r.Pedido + '|' + r.SKU, { mot: motClean(r.Motivo), prep: r.Preparador, sku: r.SKU });
  }
  const ZP: Record<string, Record<string, 1>> = {};
  for (const d in L) L[d].forEach((_, key) => { const pd = pedidoDe(key); if (enCero.has(pd)) (ZP[d] || (ZP[d] = {}))[pd] = 1; });
  const out: Record<string, MotivosDia> = {};
  for (const d of new Set([...Object.keys(L), ...Object.keys(BP), ...Object.keys(BP2)])) {
    out[d] = armarDia(L[d] || new Map(), BP[d] || {}, ZP[d] || {}, BP2[d] || {});
    out[d].nz = nz;
  }
  return out;
}

/**
 * Junta un día guardado sin líneas (antes del 6 nov 2026) con lo de un archivo nuevo: por preparador + código + motivo
 * se queda con el número mayor. Lo que el archivo nuevo trae y el día no tenía se suma; lo repetido no se duplica.
 */
function juntarSinLineas(viejo: MotivosDia, nuevo: MotivosDia): MotivosDia {
  const cel = new Map<string, number>(), prepSku = (pr: string, sku: string, k: string) => pr + '\u0001' + sku + '\u0001' + k;
  const poner = (mo: MotivosDia) => {
    for (const pr in mo.q) for (const sku in mo.q[pr]) mo.q[pr][sku].forEach((v, i) => {
      if (!v) return; const key = prepSku(pr, sku, mo.k[i]); cel.set(key, Math.max(cel.get(key) || 0, v));
    });
  };
  poner(viejo); poner(nuevo);
  const m: Record<string, number> = {}, tmp: Record<string, Record<string, Record<string, number>>> = {};
  cel.forEach((v, key) => { const [pr, sku, k] = key.split('\u0001'); m[k] = (m[k] || 0) + v; ((tmp[pr] || (tmp[pr] = {}))[sku] || (tmp[pr][sku] = {}))[k] = v; });
  const k = Object.keys(m).sort(motSort), q: MotivosDia['q'] = {};
  for (const pr in tmp) { q[pr] = {}; for (const sku in tmp[pr]) { const a = k.map((x) => tmp[pr][sku][x] || 0); while (a.length && !a[a.length - 1]) a.pop(); q[pr][sku] = a; } }
  const out: MotivosDia = { n: Object.values(m).reduce((a, b) => a + b, 0), m, k, q };
  const b = (viejo.b?.[0] || 0) >= (nuevo.b?.[0] || 0) ? viejo.b : nuevo.b;
  if (b) out.b = b;
  const z = Math.max(viejo.z || 0, nuevo.z || 0);
  if (z) out.z = z;
  const b2 = (viejo.b2?.[0] || 0) >= (nuevo.b2?.[0] || 0) ? viejo.b2 : nuevo.b2;
  if (b2) out.b2 = b2;
  return out;
}

/**
 * Pone los motivos en los días del histórico. Devuelve los días que cambiaron.
 * Si el día ya tiene líneas guardadas, junta las de este archivo con las que había (la misma línea no se cuenta
 * dos veces; si viene en los dos, vale la del archivo nuevo). Así un archivo de la mañana suma lo que se cerró en la
 * tarde del día anterior sin borrar lo que ya estaba.
 * Días guardados antes de este cambio (sin líneas): se juntan por preparador, código y motivo quedándose con lo
 * mayor de los dos (una línea que viene en los dos archivos no se cuenta dos veces).
 */
export function aplicarMotivos(history: Historial, porDia: Record<string, MotivosDia>): string[] {
  const cambiados: string[] = [];
  for (const d in porDia) {
    const h = history[d] as DiaResumen | undefined;
    if (!h || h.v !== 2) continue;
    let nuevo = porDia[d];
    const nz = nuevo.nz || [];
    delete nuevo.nz;
    const viejas = h.mot ? lineasDe(h.mot) : null;
    if (h.mot && viejas) {
      lineasDe(nuevo)!.forEach((x, key) => viejas.set(key, x));
      // pedidos en cero: los de antes y los nuevos, menos los que este archivo muestra con algo preparado o abierto
      const zp: Record<string, 1> = { ...(h.mot.zp || {}), ...(nuevo.zp || {}) }, bp2 = { ...(h.mot.bp2 || {}), ...(nuevo.bp2 || {}) };
      nz.forEach((x) => { if (!nuevo.zp?.[x]) delete zp[x]; });
      for (const x in zp) delete bp2[x];
      nuevo = armarDia(viejas, { ...(h.mot.bp || {}), ...(nuevo.bp || {}) }, zp, bp2);
    } else if (h.mot) nuevo = juntarSinLineas(h.mot, nuevo);
    if (h.mot && JSON.stringify(h.mot) === JSON.stringify(nuevo)) continue;
    h.mot = nuevo;
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

/** Fill rate del CD en unos días: preparadas ÷ (preparadas + negadas). No cuentan las negadas de pedidos en cero
 *  (todas sus líneas negadas, como el «actualizado a cero automático» del corporativo); el resto sí, también «Existencia a cero». */
export function fillRateCD(history: Historial, dias: string[]): { prep: number; neg: number; excl: number; base: number; pct: number | null } {
  let prep = 0, neg = 0, excl = 0;
  for (const d of dias) {
    const h = history[d] as DiaResumen | undefined;
    if (!h || !h.meta) continue;
    const t = h.meta.totalFinal || 0, n = h.meta.totalNegados || 0;
    prep += h.meta.totalPreparados != null ? h.meta.totalPreparados : Math.max(t - n, 0);
    neg += n;
    excl += Math.min(h.mot?.z || 0, n);
  }
  const base = prep + neg - excl;
  return { prep, neg, excl, base, pct: base ? (prep / base) * 100 : null };
}

/** Negadas de pedidos en cero de cada preparador en unos días (no cuentan en su fill rate). */
export function exclusionPorPreparador(history: Historial, dias: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dias) {
    const mo = (history[d] as DiaResumen | undefined)?.mot;
    if (!mo || !mo.zp || !mo.l || !mo.p) continue;
    for (const key in mo.l) if (mo.zp[pedidoDe(key)]) { const pr = mo.p[mo.l[key][1]]; out[pr] = (out[pr] || 0) + 1; }
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
