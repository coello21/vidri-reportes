/**
 * Regla desde el cambio del ERP (12 nov 2026): el revisador escanea y genera un LPN, y las líneas pasan a A (cerradas)
 * horas o días después, sin Fecha Actualizado. Para esos días se cuenta la línea desde que se manda a revisión:
 *  - Línea = pedido + código en R o A con Fecha Enviado Revisión (las de P todavía no se preparan).
 *  - Día = el primer día que se mandó a revisión. Resultado = el último que trae el archivo más nuevo (si en ese archivo
 *    tiene una fila preparada, cuenta como preparada: así una negada que se reasigna y se prepara sube el fill rate de
 *    su día). Si en el archivo más nuevo solo está en P (reasignada sin preparar), sigue como estaba.
 *  - Motivo = el último registrado de la línea (en R o A).
 * Con esas líneas el día se arma con el mismo cálculo del Radar (las líneas se tratan como cerradas ese día) y reemplaza
 * al día guardado. Los días del 12-nov en adelante que no se pueden rehacer (sus líneas ya no vienen en los archivos)
 * se quedan como estaban: la regla de las líneas cerradas ya no les suma nada, para no contar dos veces.
 */
import { ymd, addDays } from '../comun/fechas';
import { RadarNegados } from './radar';
import { motClean, recordarMotivos } from './motivos';
import type { Historial, Registro, DiaResumen } from './tipos';

export const DESDE_REVISION = '2026-11-12';

const ms = (x?: Date | null) => (x ? x.getTime() : 0);
function corte(recs: Registro[]): number {
  let c = 0;
  recs.forEach((r) => { c = Math.max(c, ms(r.FechaAct), ms(r.FechaRevision), ms(r.Fecha)); });
  return c;
}

/** Líneas con la regla de revisión, listas para el cálculo del Radar (estado A y día = primer envío a revisión). */
export function lineasPorRevision(archivos: Registro[][]): Registro[] {
  const M = new Map<string, { dia: number; fila: Registro; mot: string }>(), P = new Map<string, Registro>();
  const orden = archivos.map((recs) => ({ recs, c: corte(recs) })).sort((a, b) => a.c - b.c);
  for (const { recs } of orden) {
    const porK = new Map<string, Registro[]>();
    for (const r of recs) {
      if (r.Pedido == null || r.Pedido === '' || r.SKU == null) continue;
      const k = r.Pedido + '|' + r.SKU;
      (porK.get(k) || porK.set(k, []).get(k)!).push(r);
    }
    porK.forEach((rs, k) => {
      const ra = rs.filter((r) => (r.Estado === 'R' || r.Estado === 'A') && r.FechaRevision);
      if (!ra.length) { if (!M.has(k)) P.set(k, rs[0]); return; }
      P.delete(k);
      const o = M.get(k);
      const dia = Math.min(o ? o.dia : Infinity, ...ra.map((r) => ms(r.FechaRevision)));
      const fila = ra.slice().sort((a, b) =>
        Number((b.CantPrep || 0) > 0) - Number((a.CantPrep || 0) > 0) || Number(b.Estado === 'A') - Number(a.Estado === 'A') || ms(b.FechaRevision) - ms(a.FechaRevision))[0];
      const mot = motClean(fila.Motivo) || ra.map((r) => motClean(r.Motivo)).find(Boolean) || o?.mot || '';
      M.set(k, { dia, fila, mot });
    });
  }
  const out: Registro[] = [];
  M.forEach(({ dia, fila, mot }) => {
    const r: Registro = { ...fila, Estado: 'A', FechaAct: new Date(dia) };
    if ('Motivo' in fila) r.Motivo = mot;
    out.push(r);
  });
  P.forEach((r) => out.push(r));
  return out;
}

/**
 * Rehace los días del 12-nov en adelante con la regla de revisión.
 * antes = los días como estaban antes de esta carga; archivos = todos los Rpt disponibles (cualquier orden).
 * Se rehacen los días desde el día siguiente a la fecha de creación más vieja de los archivos (antes de eso pueden
 * faltar líneas); los demás vuelven a como estaban. Devuelve los días rehechos.
 */
export function rehacerDesdeRevision(radar: RadarNegados, antes: Historial, archivos: Registro[][]): string[] {
  const H = radar.history, conDatos = archivos.filter((a) => a.length);
  let minCre = '';
  conDatos.forEach((a) => a.forEach((r) => { if (r.Fecha) { const d = ymd(r.Fecha); if (!minCre || d < minCre) minCre = d; } }));
  const completo = minCre ? addDays(minCre, 1) : '9999-12-31', desde = completo > DESDE_REVISION ? completo : DESDE_REVISION;
  const nuevo = new RadarNegados({}, null);
  const filas = lineasPorRevision(conDatos);
  recordarMotivos(radar.store, filas);
  if (filas.length) nuevo.integrar(filas);
  const rehechos: string[] = [];
  const dias = new Set([...Object.keys(H), ...Object.keys(antes), ...Object.keys(nuevo.history)].filter((d) => d >= DESDE_REVISION));
  dias.forEach((d) => {
    const despues = H[d] as DiaResumen | undefined, n = nuevo.history[d] as DiaResumen | undefined;
    const v = (d >= desde && n ? n : antes[d]) as DiaResumen | undefined;
    if (!v) { delete H[d]; return; }
    // el B2B que la regla anterior ya resumió en el día se conserva
    if (despues?.meta && (despues.meta.b2bTot || despues.meta.b2bOk)) v.meta = { ...v.meta, b2bTot: despues.meta.b2bTot, b2bOk: despues.meta.b2bOk };
    H[d] = v;
    if (v === n) rehechos.push(d);
  });
  radar.limpiarCache();
  return rehechos.sort();
}
