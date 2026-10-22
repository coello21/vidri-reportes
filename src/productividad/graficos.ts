/** Gráficos de Productividad en SVG (mismo estilo que el Radar, sin librerías externas). */
import { nice } from '../app/ui/graficos';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const f1 = (v: number) => v.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const COLOR_SEM: Record<string, string> = { g: '#3E8E4F', y: '#D49A1E', r: '#C7453A', '': '#8d8788' };
export const PALETA = ['#2b6cb0', '#6b46c1', '#0891b2', '#be185d', '#4b5563', '#7c2d12', '#4338ca', '#0f766e'];

export interface Linea { nombre: string; datos: (number | null)[]; color: string; grosor?: number; punteada?: string; puntos?: boolean }

function leyenda(items: { nombre: string; color: string; punteada?: string }[]) {
  return '<div class="pv-leg">' + items.map((i) => '<span><i style="' + (i.punteada ? 'background:none;border-top:2px dashed ' + i.color : 'background:' + i.color) + '"></i>' + esc(i.nombre) + '</span>').join('') + '</div>';
}

/** Líneas con etiquetas en el eje x (semanas o días). */
export function lineas(el: HTMLElement, etiquetas: string[], series: Linea[], tituloY: string) {
  const W = Math.max(300, el.clientWidth || 520), H = 290, m = { l: 46, r: 26, t: 12, b: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = series.flatMap((s) => s.datos.filter((v): v is number => v != null));
  const max = nice(Math.max(10, ...vals));
  const n = etiquetas.length, x = (i: number) => m.l + (n < 2 ? iw / 2 : i * iw / (n - 1)), y = (v: number) => m.t + ih - v / max * ih;
  let g = '<text class="ax" transform="rotate(-90)" x="' + (-(m.t + ih / 2)) + '" y="12" text-anchor="middle">' + esc(tituloY) + '</text>';
  for (let k = 0; k <= 5; k++) { const v = max * k / 5, yy = y(v).toFixed(1); g += '<line class="gl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/><text class="ax" x="' + (m.l - 6) + '" y="' + (+yy + 3.5) + '" text-anchor="end">' + Math.round(v) + '</text>'; }
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 52))));
  etiquetas.forEach((e, i) => { if (i % step === 0 || (i === n - 1 && (n - 1) % step >= step / 2)) g += '<text class="ax" x="' + x(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="' + (i === n - 1 && n > 1 ? 'end' : i === 0 && n > 1 ? 'start' : 'middle') + '">' + esc(e) + '</text>'; });
  for (const s of series) {
    let tramo: string[] = [];
    const corta = () => { if (tramo.length > 1) g += '<polyline fill="none" stroke="' + s.color + '" stroke-width="' + (s.grosor || 2) + '"' + (s.punteada ? ' stroke-dasharray="' + s.punteada + '"' : '') + ' points="' + tramo.join(' ') + '"/>'; tramo = []; };
    const pts: string[] = [];
    s.datos.forEach((v, i) => { if (v == null) return; tramo.push(x(i).toFixed(1) + ',' + y(v).toFixed(1)); });
    corta();
    if (s.puntos !== false) s.datos.forEach((v, i) => { if (v != null) pts.push('<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="' + (s.grosor && s.grosor > 2 ? 4 : 3) + '" fill="' + s.color + '"><title>' + esc(etiquetas[i] + ' · ' + s.nombre + ': ' + f1(v)) + '</title></circle>'); });
    g += pts.join('');
  }
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img">' + g + '</svg>' + leyenda(series.map((s) => ({ nombre: s.nombre, color: s.color, punteada: s.punteada })));
}

export interface GrupoBarras { etiqueta: string; valores: { v: number | null; color: string; nombre: string }[]; meta: number | null }
/** Barras por zona: la primera barra de cada grupo es el promedio; la marca negra es la meta de la zona; la punteada, la meta global. */
export function barrasZona(el: HTMLElement, grupos: GrupoBarras[], global: number, nombres: { nombre: string; color: string }[]) {
  const W = Math.max(360, el.clientWidth || 900), H = 300, m = { l: 46, r: 12, t: 12, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = grupos.flatMap((gp) => gp.valores.map((v) => v.v || 0).concat(gp.meta || 0)).concat(global);
  const max = nice(Math.max(10, ...vals)), slot = iw / Math.max(1, grupos.length), y = (v: number) => m.t + ih - v / max * ih;
  let g = '<text class="ax" transform="rotate(-90)" x="' + (-(m.t + ih / 2)) + '" y="12" text-anchor="middle">Líneas por hora</text>';
  for (let k = 0; k <= 5; k++) { const v = max * k / 5, yy = y(v).toFixed(1); g += '<line class="gl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/><text class="ax" x="' + (m.l - 6) + '" y="' + (+yy + 3.5) + '" text-anchor="end">' + Math.round(v) + '</text>'; }
  grupos.forEach((gp, i) => {
    const x0 = m.l + slot * i, nb = gp.valores.length, bw = Math.min(46, slot * 0.72 / nb), x1 = x0 + (slot - bw * nb) / 2;
    gp.valores.forEach((b, j) => { if (b.v == null) return; const yy = y(b.v); g += '<rect x="' + (x1 + j * bw).toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + (bw - 1).toFixed(1) + '" height="' + (m.t + ih - yy).toFixed(1) + '" fill="' + b.color + '"><title>' + esc(gp.etiqueta + ' · ' + b.nombre + ': ' + f1(b.v)) + '</title></rect>'; });
    if (gp.meta != null) { const ym = y(gp.meta).toFixed(1); g += '<line x1="' + (x0 + slot * 0.2).toFixed(1) + '" x2="' + (x0 + slot * 0.8).toFixed(1) + '" y1="' + ym + '" y2="' + ym + '" stroke="#26241F" stroke-width="4"><title>Meta ' + esc(gp.etiqueta) + ': ' + gp.meta + '</title></line>'; }
    g += '<text class="ax" x="' + (x0 + slot / 2).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(gp.etiqueta) + '</text>';
  });
  const yg = y(global).toFixed(1);
  g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yg + '" y2="' + yg + '" stroke="#3E8E4F" stroke-width="2" stroke-dasharray="7 4"/>';
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img">' + g + '</svg>' +
    leyenda([{ nombre: 'Promedio de las personas', color: '#D49A1E' }, { nombre: 'Meta de la zona', color: '#26241F' }, { nombre: 'Meta global (' + global + ')', color: '#3E8E4F', punteada: '1' }, ...nombres]);
}
