/**
 * Cálculo de "Cargar Excel" con el Rpt_OrdenesPreparacion, sin pantalla: lo usan la página (carga.ts)
 * y el pipeline (scripts/procesar-rpt.ts), así los dos dan exactamente lo mismo.
 *  - Archivos de ayer + hoy: negados, Líneas preparadas, Negados sin actualizar y hora de asignación.
 *  - Archivos con todas sus fechas anteriores a ayer (historial): no se vuelven a contar líneas; solo la hora de
 *    asignación y el motivo de negado / pedidos en cero de esos días.
 */
import type { RadarNegados } from '../core/negados/radar';
import { KEEP_DAYS } from '../core/negados/radar';
import type { PedidosCD } from '../core/pedidos/cd';
import { leerExcelNegados } from '../core/negados/parseo';
import { leerExcelAsignacion, type LecturaAsignacion } from '../core/pedidos/parseo';
import { contarRevision, fotoSinActualizar } from '../core/negados/extras';
import { addDays } from '../core/comun/fechas';
import { fmtInt, fmtDateShort, etiquetaDia } from './ui/formato';

export interface ArchivoRpt { nombre: string; buf: Uint8Array }
export interface ResultadoRpt {
  /** Texto de lo que se cargó (sin "Cargado: "). */
  partes: string[];
  /** Día a mostrar después de cargar. */
  destino: string | null;
  /** Hubo líneas sin dato. */
  conError: boolean;
  /** Errores de lectura de motivos en archivos de historial (no detienen la carga). */
  avisos: string[];
}

/** Lanza un error con el nombre del archivo si uno de ayer + hoy no se puede leer (no se aplica nada de los siguientes). */
export function procesarRpt(radar: RadarNegados, pedidos: PedidosCD, archivos: ArchivoRpt[]): ResultadoRpt {
  const dias = radar.dias(), ult = dias.length ? dias[dias.length - 1] : null, lim = ult ? addDays(ult, -1) : null;
  const hist: { a: ArchivoRpt; info: LecturaAsignacion }[] = [], act: { a: ArchivoRpt; info: LecturaAsignacion | null }[] = [];
  for (const a of archivos) {
    let info: LecturaAsignacion | null = null;
    try { info = leerExcelAsignacion(a.buf); } catch (e) { console.error(e); }
    if (info && lim && info.maxDay && info.maxDay < lim) hist.push({ a, info }); else act.push({ a, info });
  }

  const partes: string[] = [], avisos: string[] = [];
  let destino: string | null = null, conError = false;
  for (const { a } of act) {
    let records;
    try { records = leerExcelNegados(a.buf); }
    catch (e) { throw new Error(a.nombre + ': no se pudo leer el archivo: ' + ((e as Error)?.message || 'error')); }
    fotoSinActualizar(radar.store, records);
    contarRevision(radar.store, records, KEEP_DAYS);
    const res = radar.cargarRegistros(records);
    const days = Object.keys(res.addedByDay).sort();
    destino = days.length ? (days.filter((d) => !radar.isPartialDay(d)).pop() || days[days.length - 1]) : destino;
    const p: string[] = [];
    p.push(res.added ? fmtInt(res.added) + ' líneas nuevas listas para despacho (' + days.map((d) => fmtDateShort(d) + ': ' + fmtInt(res.addedByDay[d])).join(', ') + ')' : 'Sin líneas nuevas');
    if (res.already) p.push(fmtInt(res.already) + ' ya estaban registradas');
    if (res.motDias) p.push('motivo de negado en ' + fmtInt(res.motDias) + ' día' + (res.motDias === 1 ? '' : 's'));
    if (res.resolved) p.push(fmtInt(res.resolved) + ' pendientes completados');
    p.push(fmtInt(res.pendingNow) + ' pendientes de despacho');
    if (res.legacyIgnored) p.push(fmtInt(res.legacyIgnored) + ' del período de la versión anterior (ya contadas)');
    if (res.fechaRespaldo) p.push(fmtInt(res.fechaRespaldo) + ' sin Fecha Actualizado (se usó Fecha Enviado Revisión)');
    if (res.sinDato) { p.push('⚠ ' + fmtInt(res.sinDato) + ' líneas sin dato (celdas vacías) no se incluyeron'); conError = true; }
    if (res.otherEstado) p.push(fmtInt(res.otherEstado) + ' con estado desconocido no se incluyeron');
    if (res.recortados?.length) p.push('se quitaron ' + res.recortados.length + ' días con más de 1 año');
    partes.push(p.join(' · '));
  }

  // archivos de historial: motivo de negado y pedidos en cero de esos días (las líneas no se vuelven a contar)
  const motH = new Set<string>();
  for (const { a } of hist) {
    try { radar.aplicarMotivosHistorial(leerExcelNegados(a.buf)).forEach((d) => motH.add(d)); }
    catch (e) { console.error(e); avisos.push(a.nombre + ': no se pudo leer el motivo de negado: ' + ((e as Error)?.message || 'error')); }
  }

  // hora de asignación (de todos los archivos que son Rpt_OrdenesPreparacion)
  let n = 0, pe = 0;
  for (const x of [...hist, ...act]) { if (!x.info) continue; const r = pedidos.aplicarAsignacion(x.info.M); n += r.a; pe += r.p; }
  if (hist.length) partes.push(hist.length + ' archivo(s) con fechas anteriores a ayer (hasta el ' + etiquetaDia(hist.map((x) => x.info.maxDay!).sort().pop()!) + '): ' +
    (motH.size ? 'se actualizó el motivo de negado y los pedidos en cero en ' + fmtInt(motH.size) + ' día' + (motH.size === 1 ? '' : 's') + '; las líneas no se volvieron a contar' : 'los negados de esas fechas ya estaban al día'));
  if (n || pe) partes.push('hora de asignación registrada para ' + fmtInt(n) + ' pedidos' + (pe ? ' (' + fmtInt(pe) + ' esperan su reporte de transferencias)' : ''));
  return { partes, destino, conError, avisos };
}
