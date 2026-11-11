/**
 * Procesa archivos Rpt_OrdenesPreparacion directamente contra la base (lo usa el pipeline, sin página):
 * lee los datos igual que la página, aplica el mismo cálculo (procesarRpt) y guarda solo lo que cambió.
 */
import { Almacen, type ResultadoGuardar } from './almacen';
import type { BaseDatos } from './base';
import { CONFIG } from './config';
import { RadarNegados } from '../core/negados/radar';
import { PedidosCD } from '../core/pedidos/cd';
import { procesarRpt, type ArchivoRpt, type ResultadoRpt } from '../app/cargaRpt';

export async function procesarRptEnBase(base: BaseDatos, archivos: ArchivoRpt[], hoy = new Date()): Promise<ResultadoRpt & { guardado: ResultadoGuardar }> {
  const almacen = new Almacen(base);
  const d = await almacen.leer({ diasRadar: CONFIG.DIAS_RADAR, diasPedidos: CONFIG.DIAS_PEDIDOS, hoy });
  const radar = new RadarNegados(d.history, d.store);
  const pedidos = new PedidosCD(d.pedidos);
  const r = procesarRpt(radar, pedidos, archivos);
  radar.persistSeen();
  pedidos.podarAsignaciones();
  const guardado = await almacen.guardar({
    history: radar.history,
    store: radar.store,
    pedidos: { rows: [...pedidos.rows.values()], cortes: pedidos.cortes, asgP: pedidos.asgP },
  }, 'pipeline');
  return { ...r, guardado };
}
