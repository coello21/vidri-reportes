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
  for (const r of rows) {
    if (r.Estado !== 'A' || r.CantPrep == null || r.Cantidad == null || r.Disponible == null) continue;
    if (!(r.CantPrep <= 0)) continue;
    const fin = r.FechaAct || r.FechaRevision;
    if (!fin) continue;
    const day = ymd(fin), o = tmp[day] || (tmp[day] = { n: 0, m: {}, q: {} }), mot = motClean(r.Motivo);
    o.n++;
    o.m[mot] = (o.m[mot] || 0) + 1;
    const pq = o.q[r.Preparador] || (o.q[r.Preparador] = {}), c = pq[r.SKU] || (pq[r.SKU] = {});
    c[mot] = (c[mot] || 0) + 1;
  }
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
  }
  return out;
}

/** Pone los motivos en los días del histórico. Devuelve los días que cambiaron. */
export function aplicarMotivos(history: Historial, porDia: Record<string, MotivosDia>): string[] {
  const cambiados: string[] = [];
  for (const d in porDia) {
    const h = history[d] as DiaResumen | undefined;
    if (!h || h.v !== 2) continue;
    if (h.mot && h.mot.n > porDia[d].n) continue;
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
