/**
 * Cálculos que se agregaron al Radar el 20 oct 2026 (mismas reglas que /radar/):
 *  - Líneas preparadas: líneas entregadas al revisador ("Fecha Enviado Revisión"), criterio del área de preparación.
 *  - Negados sin actualizar: foto del último Excel de las líneas mandadas a revisión en 0 y aún sin cerrar.
 */
import { ymd, addDays, timeOf } from '../comun/fechas';
import type { Registro, StoreRadar } from './tipos';

type Store = StoreRadar & {
  revN?: Record<string, number>;
  revK?: Record<string, string>;
  revX?: Record<string, string>;
  revKT?: number;
  pneg?: { t: number; rows: FilaSinActualizar[] };
  rev?: unknown; revT?: unknown;
};

/** [pedido, orden, sucursal, sku, descripción, UM, cantidad, disponible, ubicación 1, ubicación 2, preparador, fecha de revisión (ms)] */
export type FilaSinActualizar = [string, string, string, string, string, string, number | null, number | null, string, string, string, number];

function corteDe(records: Registro[]): number {
  let corte = 0;
  records.forEach((r) => { [r.FechaAct, r.FechaRevision, r.Fecha].forEach((x) => { const v = timeOf(x); if (v > corte) corte = v; }); });
  return corte;
}

/**
 * Cuenta cada línea (Pedido + Código) una sola vez, en el día de su última "Fecha Enviado Revisión" (criterio del área):
 * si la reasignan (orden nueva) y la entregan otro día, se quita del día anterior y se suma al nuevo; si se entregó un día
 * y se actualizó al siguiente, se queda en el día de la entrega.
 * Guarda el total por día (revN) y las llaves de los últimos `keepDays` días (revK) para no contar doble;
 * si un Excel más nuevo trae otra fecha, la mueve de día; si la trae sin fecha (se devolvió), la quita y la
 * anota en revX para que un Excel más viejo no la vuelva a sumar. Las llaves "pedido|orden|sku" guardadas
 * se leen como "pedido|sku". Devuelve los días que cambiaron.
 */
export function contarRevision(store: StoreRadar, records: Registro[], keepDays: number): Set<string> {
  const S = store as Store;
  S.revN = S.revN || {}; S.revK = S.revK || {};
  delete S.rev; delete S.revT;
  const corte = corteDe(records), by = new Map<string, Registro>();
  const tr = (x?: Date | null) => (x ? x.getTime() : 0);
  records.forEach((r) => {
    if (r.Pedido == null || r.Pedido === '' || r.SKU == null) return;
    const k = r.Pedido + '|' + r.SKU, o = by.get(k);
    // varias órdenes de la misma línea: manda la última entrega al revisador
    if (!o || tr(r.FechaRevision) > tr(o.FechaRevision) || (tr(r.FechaRevision) === tr(o.FechaRevision) && r.Estado === 'A' && o.Estado !== 'A')) by.set(k, r);
  });
  const newer = corte >= (S.revKT || 0);
  const leer = (o?: Record<string, string>): Map<string, string> => {
    const M = new Map<string, string>();
    for (const d in o || {}) (o![d] ? o![d].split(',') : []).forEach((k) => {
      const p = k.split('|'), k2 = p.length === 3 ? p[0] + '|' + p[2] : k, e = M.get(k2);
      if (!e || d > e) M.set(k2, d);
    });
    return M;
  };
  const K = leer(S.revK), X = leer(S.revX), N = S.revN, touched = new Set<string>();
  X.forEach((_d, k) => { if (K.has(k)) X.delete(k); });
  const add = (d: string, n: number) => { N[d] = (N[d] || 0) + n; if (N[d] <= 0) delete N[d]; touched.add(d); };
  by.forEach((r, k) => {
    const old = K.get(k), d = r.FechaRevision ? ymd(r.FechaRevision) : null;
    if (d && !old) { if (!newer && X.has(k)) return; K.set(k, d); X.delete(k); add(d, 1); }
    else if (d && old && old !== d && newer) { K.set(k, d); add(old, -1); add(d, 1); }
    else if (!d && old && newer) { K.delete(k); X.set(k, old); add(old, -1); }
  });
  if (newer) S.revKT = corte;
  const days = [...new Set(K.values())].sort(), keep = days.length ? addDays(days[days.length - 1], -keepDays) : null;
  const guardar = (M: Map<string, string>) => {
    const G: Record<string, string[]> = {};
    M.forEach((d, k) => { if (keep && d < keep) return; (G[d] || (G[d] = [])).push(k); });
    const o: Record<string, string> = {};
    for (const d in G) o[d] = G[d].join(',');
    return o;
  };
  S.revK = guardar(K); S.revX = guardar(X);
  return touched;
}

/** Líneas preparadas (entregadas al revisador) en un rango; null si no hay datos de esos días. */
export function lineasPreparadas(store: StoreRadar, from: string, to: string): number | null {
  const N = (store as Store).revN || {};
  let s = 0, has = false;
  for (const d in N) { if (d < from || d > to) continue; has = true; s += N[d]; }
  return has ? s : null;
}

/** Guarda la foto de "negados sin actualizar" si el Excel es igual o más nuevo que la última. Devuelve si cambió. */
export function fotoSinActualizar(store: StoreRadar, records: Registro[]): boolean {
  const S = store as Store, corte = corteDe(records), by = new Map<string, Registro[]>();
  records.forEach((r) => { const k = r.Pedido + '|' + r.SKU; (by.get(k) || by.set(k, []).get(k)!).push(r); });
  const rows: FilaSinActualizar[] = [];
  by.forEach((L) => {
    if (L.some((r) => r.FechaAct || (r.CantPrep || 0) > 0)) return;
    const r = L.find((x) => x.FechaRevision);
    if (!r || r.CantPrep !== 0) return;
    rows.push([String(r.Pedido), String(r.Orden || ''), r.Sucursal || '', String(r.SKU), r.Desc || '', String(r.UM || ''), r.Cantidad, r.Disponible,
      String(r.Ubic1 || ''), String(r.Ubic2 || ''), r.Preparador || '', r.FechaRevision!.getTime()]);
  });
  if (corte && (!S.pneg || corte >= S.pneg.t)) { S.pneg = { t: corte, rows }; return true; }
  return false;
}

/**
 * rev = última vez que se mandó a revisión (ms), de todas las líneas del código.
 * motivo = según el Disponible del último Excel: positivo (había stock: error en el proceso), cero (sin existencia) o negativo.
 */
export interface CodigoSinActualizar { sku: string; desc: string; um: string; disp: number; n: number; q: number; ubic: string[]; suc: string[]; pedidos: number; rev: number; motivo: 'positivo' | 'cero' | 'negativo' }

/**
 * Negados que todavía no pasan a actualizado, con el mismo código sumado y los tres motivos
 * (el Disponible es el del último Excel, así que es la existencia más reciente).
 * Orden: error en el proceso, sin existencia, inventario negativo; dentro, los más negados primero.
 */
export function sinActualizarPorCodigo(store: StoreRadar): { t: number; codigos: CodigoSinActualizar[] } | null {
  const P = (store as Store).pneg;
  if (!P) return null;
  const rk = (v: number | null) => ((v || 0) > 0 ? 0 : v === 0 ? 1 : 2);
  const rows = P.rows.slice().sort((a, b) => rk(a[7]) - rk(b[7]) || String(a[8]).localeCompare(String(b[8])) || a[11] - b[11]);
  type G = { sku: string; desc: string; um: string; disp: number; n: number; q: number; min: number; ub: Set<string>; suc: Set<string>; ped: Set<string>; t: number };
  const M = new Map<string, G>();
  rows.forEach((r) => {
    let g = M.get(r[3]);
    if (!g) { g = { sku: r[3], desc: r[4], um: r[5], disp: r[7] || 0, n: 0, q: 0, min: Infinity, ub: new Set(), suc: new Set(), ped: new Set(), t: r[11] }; M.set(r[3], g); }
    g.n++; g.q += r[6] || 0; g.min = Math.min(g.min, r[6] || 0);
    if (r[11] > g.t) { g.t = r[11]; g.disp = r[7] || 0; }
    [r[8], r[9]].forEach((u) => { if (u) g!.ub.add(u); });
    if (r[2]) g.suc.add(r[2]);
    g.ped.add(r[0]);
  });
  const codigos = [...M.values()]
    .sort((a, b) => rk(a.disp) - rk(b.disp) || b.n - a.n || b.q - a.q || String([...a.ub][0] || '').localeCompare(String([...b.ub][0] || '')))
    .map((g) => ({ sku: g.sku, desc: g.desc, um: g.um, disp: g.disp, n: g.n, q: g.q, ubic: [...g.ub], suc: [...g.suc], pedidos: g.ped.size, rev: g.t, motivo: (g.disp > 0 ? 'positivo' : g.disp === 0 ? 'cero' : 'negativo') as CodigoSinActualizar['motivo'] }));
  return { t: P.t, codigos };
}
