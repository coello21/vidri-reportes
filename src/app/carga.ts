/**
 * "Cargar Excel" de la versión nueva. Mismas reglas que /radar/:
 *  - Rpt_OrdenesPreparacion (ayer + hoy): negados, Líneas preparadas, Negados sin actualizar y hora de asignación.
 *    Si todas sus fechas son anteriores a ayer (historial por semanas), no se vuelven a contar líneas: solo la hora de
 *    asignación y el motivo de negado / pedidos en cero de esos días.
 *  - Document.xlsx / .csv (reporte de transferencias): pedidos CD. También acepta el Rpt_OrdenesPreparacion para la asignación.
 * Después se guarda en Supabase solo lo que cambió.
 */
import type { RadarNegados } from '../core/negados/radar';
import type { PedidosCD } from '../core/pedidos/cd';
import { leerExcelPedidos, leerExcelAsignacion } from '../core/pedidos/parseo';
import type { Almacen, ResultadoGuardar } from '../nube/almacen';
import { fmtInt } from './ui/formato';
import { procesarRpt, type ArchivoRpt, type ResultadoRpt } from './cargaRpt';
import { aviso } from './ui/avisos';
import { MESES_CORTO } from '../core/comun/fechas';

export interface Contexto {
  radar: RadarNegados;
  pedidos: PedidosCD;
  almacen: Almacen | null;
  /** Se cumple cuando ya se leyeron los días anteriores (false si falló). Cargar un Excel espera a que estén. */
  listo?: () => Promise<boolean>;
  /** Vuelve a dibujar las pantallas; `dia` = día de negados a mostrar. */
  redibujar: (dia: string | null) => void;
}

const esExcel = (f: File) => /\.(xlsx|xls|xlsm)$/i.test(f.name);
const corteTxt = (min: number) => {
  const d = new Date(min * 60000);
  let h = d.getUTCHours();
  const ap = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return d.getUTCDate() + ' ' + MESES_CORTO[d.getUTCMonth()] + ', ' + h + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' ' + ap;
};

let ocupado = false;

/** Antes de cargar un Excel deben estar todos los días leídos (si no, al guardar se podrían pisar datos). */
async function esperar(ctx: Contexto): Promise<boolean> {
  if (!ctx.listo) return true;
  const p = ctx.listo();
  let hecho = false;
  void p.then(() => { hecho = true; });
  await Promise.resolve();
  if (!hecho) aviso('ok', 'Terminando de cargar los días anteriores; el Excel se carga en cuanto terminen…', 120000);
  const ok = await p;
  if (!ok) aviso('err', 'No se pudieron cargar los días anteriores. Recarga la página y vuelve a cargar el Excel.', 30000);
  return ok;
}

/** Guarda en Supabase lo que cambió. Devuelve el resultado o null si falló (y ya avisó). */
async function guardar(ctx: Contexto, previo: string): Promise<ResultadoGuardar | null> {
  if (!ctx.almacen) {
    aviso('ok', previo + (import.meta.env.MODE === 'copia' ? ' · Cargado en esta copia: usa Descargar HTML para guardar un archivo con estos datos.' : ' (modo de prueba: no se guarda).'), 30000);
    return null;
  }
  aviso('ok', 'Guardando en la base…', 60000);
  try {
    ctx.radar.persistSeen();
    ctx.pedidos.podarAsignaciones();
    return await ctx.almacen.guardar({
      history: ctx.radar.history,
      store: ctx.radar.store,
      pedidos: { rows: [...ctx.pedidos.rows.values()], cortes: ctx.pedidos.cortes, asgP: ctx.pedidos.asgP },
    }, 'excel');
  } catch (e) {
    console.error(e);
    aviso('err', 'Se cargó en pantalla, pero no se pudo guardar en la base: ' + ((e as Error)?.message || 'error') + '. Vuelve a cargar el Excel en un momento.', 40000);
    return null;
  }
}

/** Botón "Cargar Excel" de Resumen / Top negados. */
export async function cargarNegados(ctx: Contexto, files: File[]) {
  if (ocupado) return;
  const xs = files.filter(esExcel);
  if (!xs.length) { aviso('err', 'Selecciona el Excel Rpt_OrdenesPreparacion (ayer + hoy).', 10000); return; }
  ocupado = true;
  try {
    if (!(await esperar(ctx))) return;
    const archivos: ArchivoRpt[] = [];
    for (const f of xs) archivos.push({ nombre: f.name, buf: new Uint8Array(await f.arrayBuffer()) });
    let r: ResultadoRpt;
    try { r = procesarRpt(ctx.radar, ctx.pedidos, archivos); }
    catch (e) { aviso('err', (e as Error)?.message || 'no se pudo leer el archivo', 15000); return; }
    r.avisos.forEach((t) => aviso('err', t, 15000));
    const { partes, destino, conError } = r;

    ctx.redibujar(destino || ctx.radar.lastCompleteDay());
    const txt = 'Cargado: ' + partes.join(' · ');
    const g = await guardar(ctx, txt);
    if (g) aviso(conError ? 'err' : 'ok', (g.dias || g.pedidos || g.catalogo || g.cortes ? 'Guardado en la base. ' : 'La base ya estaba al día. ') + txt, 30000);
  } finally { ocupado = false; }
}

/** Botón "Cargar Excel" de Pedidos CD. */
export async function cargarPedidos(ctx: Contexto, files: File[]) {
  if (ocupado || !files.length) return;
  ocupado = true;
  try {
    if (!(await esperar(ctx))) return;
    let n = 0, nuevos = 0, cambios = 0, corte = 0, viejos = 0, otras = 0;
    const asg = { a: 0, p: 0, f: 0 };
    for (const f of files) {
      try {
        const esCsv = /\.csv$/i.test(f.name);
        const data = esCsv ? await f.text() : new Uint8Array(await f.arrayBuffer());
        const ra = esCsv ? null : leerExcelAsignacion(data as Uint8Array);
        if (ra) { const r = ctx.pedidos.aplicarAsignacion(ra.M); asg.a += r.a; asg.p += r.p; asg.f++; continue; }
        const p = leerExcelPedidos(data, esCsv);
        otras += p.otras; n += p.rows.length;
        const r = ctx.pedidos.integrar(p.rows);
        nuevos += r.nuevos; cambios += r.cambios; viejos += r.viejos; corte = Math.max(corte, r.corte);
      } catch (e) { console.error(e); aviso('err', f.name + ': ' + ((e as Error)?.message || 'no se pudo leer'), 20000); return; }
    }
    ctx.redibujar(null);
    const tA = asg.f ? asg.f + ' reporte(s) de órdenes: hora de asignación registrada para ' + fmtInt(asg.a) + ' pedidos' + (asg.p ? ' y ' + fmtInt(asg.p) + ' quedan en espera de su reporte de transferencias' : '') + '. ' : '';
    const txt = tA + (n ? fmtInt(n) + ' pedidos leídos (corte ' + corteTxt(corte) + '): ' + fmtInt(nuevos) + ' nuevos, ' + fmtInt(cambios) + ' cambiaron de estado' +
      (otras ? '. Se descartaron ' + fmtInt(otras) + ' de otras bodegas (MOP u otras)' : '') + (viejos ? '. Se omitieron ' + fmtInt(viejos) + ' con fecha de más de 60 días' : '') + '.' : '');
    const g = await guardar(ctx, txt);
    if (g) aviso('ok', 'Guardado. ' + txt, 30000);
  } finally { ocupado = false; }
}

