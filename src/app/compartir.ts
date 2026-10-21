/**
 * "Descargar HTML": la copia de los últimos 45 días que se comparte.
 * Es esta misma página en un solo archivo (plantilla.html, se arma al publicar) con los datos adentro,
 * así que se ve igual y funciona sin internet. En la copia solo quedan Cargar Excel y Descargar HTML.
 */
import type { RadarNegados } from '../core/negados/radar';
import type { PedidosCD } from '../core/pedidos/cd';
import { addDays } from '../core/comun/fechas';
import { aviso, descargar } from './ui/avisos';
import { fmtDateShort } from './ui/formato';

/** Días que lleva la copia. */
export const DIAS_COPIA = 45;

export interface DatosCopia {
  history: RadarNegados['history'];
  store: RadarNegados['store'];
  pedidos: { rows: unknown[]; cortes: PedidosCD['cortes']; asgP: PedidosCD['asgP'] } | null;
}

/* ---------------- comprimir / descomprimir (gzip + base64) ---------------- */
async function gzB64(txt: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') throw new Error('Este navegador no puede comprimir. Usa Chrome o Edge actualizados.');
  const buf = new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
  return btoa(s);
}
export async function leerB64(b64: string): Promise<DatosCopia> {
  const bin = atob(b64.trim()), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return JSON.parse(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}

/** Días de pedidos terminados que lleva la copia (la pestaña Pedidos CD muestra 15; uno más para el arrastre del primer día). */
export const DIAS_PEDIDOS_COPIA = 16;

/**
 * Datos de la copia:
 *  - negados: los 45 días, sin el detalle de códigos preparados por preparador (solo sirve para el Excel de preparadores);
 *  - pedidos: los pendientes y los de los últimos 16 días (de ahí salen los conteos por día de la pestaña);
 *  - las líneas ya contadas, para que "Cargar Excel" en la copia no cuente doble.
 */
export function datosCopia(radar: RadarNegados, pedidos: PedidosCD): { datos: DatosCopia; desde: string; hasta: string } {
  radar.persistSeen();
  const dias = radar.dias(), hasta = dias[dias.length - 1], desde = addDays(hasta, -(DIAS_COPIA - 1));
  const history: DatosCopia['history'] = {};
  dias.filter((d) => d >= desde).forEach((d) => {
    const r = radar.history[d] as unknown as Record<string, unknown>;
    if (r && typeof r === 'object' && 'prepSkus' in r) { const { prepSkus: _p, ...resto } = r; history[d] = resto as unknown as typeof radar.history[string]; }
    else history[d] = radar.history[d];
  });
  const lc = pedidos.ultimoCorte(), lim = (lc || 0) - DIAS_PEDIDOS_COPIA * 1440;
  const rows = [...pedidos.rows.values()].filter((x) => x[3] !== 'A' || x[2] >= lim || (x[6] || 0) >= lim);
  return { datos: { history, store: radar.store, pedidos: { rows, cortes: pedidos.cortes, asgP: pedidos.asgP } }, desde: Object.keys(history).sort()[0], hasta };
}

/** Texto del encabezado de la copia. */
export function textoCopia(desde: string, hasta: string): string {
  return 'Últimos ' + DIAS_COPIA + ' días (' + fmtDateShort(desde) + ' – ' + fmtDateShort(hasta) + ')';
}

/* ---------------- plantilla ---------------- */
const leerTexto = async (u: string) => { try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.text() : null; } catch { return null; } };
const sinCierre = (s: string) => s.replace(/<\/script/gi, '<\\/script');

/** En la página (/app/): plantilla.html con el diseño (tema.css y tema.js) adentro. */
export async function plantillaEnLinea(): Promise<string> {
  const tpl = await leerTexto('./plantilla.html');
  if (!tpl) throw new Error('no se encontró la plantilla (plantilla.html)');
  const css = await leerTexto('../nube/tema.css'), js = await leerTexto('../nube/tema.js');
  if (!css || !js) throw new Error('no se encontró el diseño (tema.css / tema.js)');
  return tpl
    .replace(/<link[^>]*href="\.\.\/nube\/tema\.css"[^>]*>/, () => '<style id="tema-css">' + css + '</style>')
    .replace(/<script[^>]*src="\.\.\/nube\/tema\.js"[^>]*><\/script>/, () => '<script>' + sinCierre(js) + '</script>')
    .replace(/<script[^>]*src="\.\.\/nube\/reporte\.js"[^>]*><\/script>/, '');
}

/** En la copia: el mismo archivo tal como se abrió (se guarda al arrancar, antes de dibujar). */
let propia: string | null = null;
export function guardarPropia() { propia = '<!doctype html>\n' + document.documentElement.outerHTML; }
export async function plantillaPropia(): Promise<string> {
  if (!propia) throw new Error('no se encontró la plantilla');
  return propia;
}

/* ---------------- botón ---------------- */
export async function descargarHtml(btn: HTMLButtonElement, radar: RadarNegados, pedidos: PedidosCD, plantilla: () => Promise<string>) {
  const t0 = btn.textContent;
  btn.disabled = true; btn.textContent = 'Preparando…';
  try {
    if (!radar.dias().length) throw new Error('todavía no hay datos');
    const tpl = await plantilla();
    const { datos } = datosCopia(radar, pedidos);
    const b64 = await gzB64(JSON.stringify(datos));
    // La etiqueta de datos va al final del archivo. Este mismo texto también aparece dentro del código de la página,
    // así que se busca la última y se revisa que lo de adentro sea solo base64 (datos), no código.
    const TAG = '<script type="text/plain" id="emb">', FIN = '</' + 'script>', emb = TAG + b64 + FIN;
    let html: string | null = null;
    const i = tpl.lastIndexOf(TAG);
    if (i >= 0) {
      const j = tpl.indexOf(FIN, i + TAG.length);
      if (j > 0 && /^[A-Za-z0-9+/=\s]*$/.test(tpl.slice(i + TAG.length, j))) html = tpl.slice(0, i) + emb + tpl.slice(j + FIN.length);
    }
    if (html == null) {
      const k = tpl.toLowerCase().lastIndexOf('</body>');
      if (k < 0) throw new Error('plantilla incompleta');
      html = tpl.slice(0, k) + emb + tpl.slice(k);
    }
    const n = new Date(), hoy = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    descargar(new Blob([html], { type: 'text/html' }), 'Radar_de_Negados_' + hoy + '.html');
    aviso('ok', 'Descargando el HTML de los últimos ' + DIAS_COPIA + ' días…');
  } catch (e) {
    console.error(e);
    aviso('err', 'No se pudo preparar el HTML: ' + ((e as Error)?.message || 'error'), 15000);
  } finally {
    btn.disabled = false; btn.textContent = t0;
  }
}
