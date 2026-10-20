/** Gráficos SVG compartidos por las pantallas (misma apariencia que el Radar original). */
import { diaSemana } from '../../core/comun/fechas';
import { fmtInt, dowCorto, diaConSemana, etiquetaDia } from './formato';

/** Redondea hacia arriba a un valor "bonito" para el eje. */
export function nice(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return ([1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((s) => s >= n - 1e-9) || 10) * p;
}
export const corto = (v: number): string => (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',') + ' mil' : fmtInt(v));

function regresion(vals: number[]) {
  const n = vals.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  vals.forEach((v, i) => { sx += i; sy += v; sxy += i * v; sxx += i * i; });
  const b = (n * sxy - sx * sy) / ((n * sxx - sx * sx) || 1), a = (sy - b * sx) / n;
  return { a, b, mean: sy / n, n };
}
/** Con 10 días o más: promedio móvil de 7 días (quita el efecto lunes/fin de semana). */
function promedioMovil(vals: number[]): [number, number][] | null {
  if (vals.length < 10) return null;
  const o: [number, number][] = [];
  for (let k = 6; k < vals.length; k++) { let t = 0; for (let j = k - 6; j <= k; j++) t += vals[j]; o.push([k, t / 7]); }
  return o;
}
/** % de cambio: últimos 7 días contra los 7 anteriores (o pendiente de la recta con menos datos). */
export function tendenciaPct(vals: number[]): number | null {
  if (vals.length >= 14) {
    const a = vals.slice(-7).reduce((p, q) => p + q, 0), b = vals.slice(-14, -7).reduce((p, q) => p + q, 0);
    return b ? (a - b) / b * 100 : null;
  }
  const r = regresion(vals);
  if (!r || !r.mean) return null;
  return r.b * (r.n - 1) / r.mean * 100;
}
/** Puntos de la línea de tendencia para un <polyline>. */
export function tendenciaPuntos(vals: number[], X: (i: number) => number, Y: (v: number) => number): string {
  const ma = promedioMovil(vals);
  if (ma) return ma.map(([k, v]) => X(k).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
  const r = regresion(vals);
  if (!r) return '';
  return X(0).toFixed(1) + ',' + Y(Math.max(0, r.a)).toFixed(1) + ' ' + X(vals.length - 1).toFixed(1) + ',' + Y(Math.max(0, r.a + r.b * (vals.length - 1))).toFixed(1);
}
export const tendenciaTexto = (v: number | null): string =>
  v == null ? 'sin datos suficientes' : Math.abs(v) < 5 ? 'estable' : v > 0 ? 'sube ' + Math.round(v) + '%' : 'baja ' + Math.round(-v) + '%';

export interface Serie { name: string; color: string; tcolor?: string; vals: number[] }
export interface OpcBarras {
  partial?: Set<number>; trendEach?: boolean; noTrend?: boolean; avg?: boolean;
  onClick?: (i: number) => void; unit?: string; sel?: string | null; h?: number;
}

/** Barras apiladas por día con tendencia (línea discontinua). */
export function barrasApiladas(el: HTMLElement, days: string[], series: Serie[], opt: OpcBarras = {}) {
  const part = opt.partial || new Set<number>(), unit = opt.unit || 'pedidos';
  const W = Math.max(300, el.clientWidth || 900), H = opt.h || 260, m = { l: 50, r: 20, t: 14, b: 38 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = days.length;
  const tot = days.map((_, i) => series.reduce((a, s) => a + (s.vals[i] || 0), 0));
  const max = nice(Math.max(1, ...tot)), slot = iw / Math.max(1, n), bw = Math.max(2, Math.min(34, slot * 0.68));
  const cx = (i: number) => m.l + slot * i + slot / 2, y = (v: number) => m.t + ih - (v / max) * ih;
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = max * k / 4, yy = y(v).toFixed(1); g += '<line class="gl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/><text class="ax" x="' + (m.l - 8) + '" y="' + (+yy + 3.5) + '" text-anchor="end">' + corto(v) + '</text>'; }
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 46))));
  const lastLbl = Math.floor((n - 1) / step) * step, showLast = (n - 1) === lastLbl || (cx(n - 1) - cx(lastLbl)) >= 46;
  days.forEach((d, i) => {
    let y0 = m.t + ih;
    const tip = [diaConSemana(d) + (part.has(i) ? ' (parcial)' : '')].concat(series.map((s) => s.name + ': ' + fmtInt(s.vals[i] || 0))).concat(series.length > 1 ? ['Total: ' + fmtInt(tot[i]) + ' ' + unit] : []).join('\n');
    g += '<g class="bar' + (opt.onClick ? ' clk' : '') + (opt.sel === d ? ' sel' : '') + '" data-i="' + i + '" opacity="' + (part.has(i) ? 0.45 : 1) + '"><title>' + tip + '</title>';
    series.forEach((s) => { const v = s.vals[i] || 0; if (!v) return; const h = (v / max) * ih; y0 -= h; g += '<rect x="' + (cx(i) - bw / 2).toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.5, h).toFixed(1) + '" fill="' + s.color + '"/>'; });
    g += '<rect x="' + (cx(i) - slot / 2).toFixed(1) + '" y="' + m.t + '" width="' + slot.toFixed(1) + '" height="' + ih + '" fill="transparent"/></g>';
    if (i % step === 0 || (i === n - 1 && showLast)) {
      const w = diaSemana(d);
      g += '<text class="ax' + ((w === 1 || w === 2) ? ' pk' : '') + '" x="' + cx(i).toFixed(1) + '" y="' + (H - 22) + '" text-anchor="middle">' + dowCorto(d) + '</text><text class="ax" x="' + cx(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle">' + etiquetaDia(d) + '</text>';
    }
  });
  const idx = days.map((_, i) => i).filter((i) => !part.has(i));
  const tl = (vals: number[], col?: string) => {
    const pts = tendenciaPuntos(idx.map((i) => vals[i]), (k) => cx(idx[k]), y);
    return pts ? '<polyline fill="none" points="' + pts + '" stroke="' + (col || '#26241F') + '" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"/>' : '';
  };
  if (opt.avg) {
    const ok = idx.map((i) => tot[i]), av = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0, ya = y(av).toFixed(1);
    g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + ya + '" y2="' + ya + '" stroke="#26241F" stroke-width="1.6" stroke-dasharray="6 4" pointer-events="none"/><text class="ax avg" x="' + (W - m.r) + '" y="' + (+ya - 6) + '" text-anchor="end">Promedio ' + (av >= 10 ? fmtInt(av) : av.toFixed(1).replace('.', ',')) + '</text>';
  }
  if (!opt.noTrend) { if (opt.trendEach) series.forEach((s) => { g += tl(s.vals, s.tcolor || s.color); }); else g += tl(tot); }
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img">' + g + '</svg>';
  if (opt.onClick) el.querySelectorAll<SVGGElement>('g.bar').forEach((b) => b.addEventListener('click', () => opt.onClick!(+b.dataset.i!)));
}

/** Línea de tendencia sobre los puntos de un gráfico de líneas (sin contar días parciales). */
export function tendenciaSobrePuntos(svg: SVGSVGElement, sel: string, esParcial: (d: string) => boolean, groupAttr?: string) {
  svg.querySelectorAll('.vx-trend').forEach((n) => n.remove());
  const groups: Record<string, [number, number][]> = {};
  svg.querySelectorAll(sel).forEach((c) => {
    const d = c.getAttribute('data-date');
    if (d && esParcial(d)) return;
    const k = groupAttr ? c.getAttribute(groupAttr) || '_' : '_';
    (groups[k] || (groups[k] = [])).push([+c.getAttribute('cx')!, +c.getAttribute('cy')!]);
  });
  Object.values(groups).forEach((P) => {
    if (P.length < 3) return;
    P.sort((p, q) => p[0] - q[0]);
    const pts = tendenciaPuntos(P.map((p) => p[1]), (k) => P[k][0], (v) => v);
    if (!pts) return;
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    ln.setAttribute('class', 'vx-trend'); ln.setAttribute('points', pts); ln.setAttribute('fill', 'none');
    ln.setAttribute('stroke', '#26241F'); ln.setAttribute('stroke-width', '1.6'); ln.setAttribute('stroke-dasharray', '6 4');
    ln.setAttribute('vector-effect', 'non-scaling-stroke'); ln.setAttribute('pointer-events', 'none');
    svg.appendChild(ln);
  });
}

/** Muestra el globo de un punto de un gráfico al pasar el mouse. */
export function globoEnPuntos(svg: SVGSVGElement, wrap: HTMLElement, tip: HTMLElement, sel: string, W: number, H: number, texto: (c: Element) => string) {
  svg.querySelectorAll(sel).forEach((dot) => {
    dot.addEventListener('mouseenter', () => {
      tip.textContent = texto(dot);
      const rect = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const cx = parseFloat(dot.getAttribute('cx')!) / W * rect.width, cy = parseFloat(dot.getAttribute('cy')!) / H * rect.height;
      tip.style.left = (rect.left - wr.left + cx) + 'px';
      tip.style.top = (rect.top - wr.top + cy) + 'px';
      tip.style.opacity = '1';
    });
    dot.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
  });
}

/** Texto corto de tendencia con flecha (para rankings). */
export const tendenciaEtiqueta = (p: number | null): string => {
  if (p == null) return '<span class="tr0">sin datos</span>';
  const a = Math.abs(p);
  if (a < 5) return '<span class="tr0">estable</span>';
  return '<span class="' + (p > 0 ? 'trU' : 'trD') + '" title="Últimos 7 días contra los 7 anteriores">' + (p > 0 ? '↑ sube ' : '↓ baja ') + Math.round(a) + '%</span>';
};

export interface SerieLinea { name: string; color: string; vals: number[]; off?: number }
/** Líneas por día con tendencia (SKUs entran vs atendidos). */
export function lineas(el: HTMLElement, days: string[], series: SerieLinea[], opt: { partial?: Set<number> } = {}) {
  const part = opt.partial || new Set<number>();
  const W = Math.max(300, el.clientWidth || 900), H = 250, m = { l: 52, r: 58, t: 14, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = nice(Math.max(1, ...series.flatMap((s) => s.vals)));
  const x = (i: number) => m.l + (days.length < 2 ? iw / 2 : i * iw / (days.length - 1)), y = (v: number) => m.t + ih - (v / max) * ih;
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = max * k / 4, yy = y(v).toFixed(1); g += '<line class="gl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/><text class="ax" x="' + (m.l - 8) + '" y="' + (+yy + 3.5) + '" text-anchor="end">' + corto(v) + '</text>'; }
  const step = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(iw / 64))));
  const lastL = Math.floor((days.length - 1) / step) * step, showL = (days.length - 1) === lastL || (x(days.length - 1) - x(lastL)) >= 60;
  days.forEach((d, i) => { if (i % step === 0 || (i === days.length - 1 && showL)) g += '<text class="ax" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + etiquetaDia(d) + '</text>'; });
  const idx = days.map((_, i) => i).filter((i) => !part.has(i));
  series.forEach((s) => {
    g += '<polyline fill="none" stroke="' + s.color + '" stroke-width="2" points="' + s.vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ') + '"/>';
    s.vals.forEach((v, i) => { g += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="' + (days.length > 40 ? 1.8 : 3) + '" fill="' + s.color + '"' + (part.has(i) ? ' opacity=".45"' : '') + '><title>' + diaConSemana(days[i]) + ' · ' + s.name + ': ' + fmtInt(v) + ' SKUs</title></circle>'; });
    const pts = tendenciaPuntos(idx.map((i) => s.vals[i]), (k) => x(idx[k]), y);
    if (pts) g += '<polyline fill="none" points="' + pts + '" stroke="' + s.color + '" stroke-width="2" stroke-dasharray="6 4" opacity=".9"/>';
    const li = s.vals.length - 1;
    if (li >= 0) g += '<text class="lb" x="' + (x(li) + 8).toFixed(1) + '" y="' + (y(s.vals[li]) + (s.off || 0) + 4).toFixed(1) + '" fill="' + s.color + '">' + corto(s.vals[li]) + '</text>';
  });
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img">' + g + '</svg>';
}

export interface ItemBarra { l: string; s?: string; v: number; p?: number | null; c?: string }
/** Barras horizontales simples. */
export function barras(el: HTMLElement, items: ItemBarra[], escapar: (s: string) => string) {
  const max = Math.max(1, ...items.map((i) => i.v));
  el.className = 'vx-bars';
  el.innerHTML = items.length ? items.map((i) => '<div class="vb"><div class="vb-l"><b>' + escapar(i.l) + '</b>' + (i.s ? '<span>' + i.s + '</span>' : '') + '</div><div class="vb-t"><i style="width:' + Math.max(i.v ? 1 : 0, i.v / max * 100) + '%;background:' + (i.c || 'var(--blue)') + '"></i></div><div class="vb-n">' + fmtInt(i.v) + (i.p != null ? '<span>' + i.p + '%</span>' : '') + '</div></div>').join('') : '<p class="q">Sin datos en el periodo.</p>';
}

function miniTendencia(vals: number[], col?: string) {
  const W = 96, H = 24, max = Math.max(1, ...vals), n = vals.length;
  if (n < 2) return '';
  const x = (i: number) => i * (W - 2) / (n - 1) + 1, y = (v: number) => H - 2 - (v / max) * (H - 4), tp = tendenciaPuntos(vals, x, y);
  return '<svg class="spk" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><polyline fill="none" stroke="' + (col || '#3A76B0') + '" stroke-width="1" opacity=".55" points="' + vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ') + '"/>' + (tp ? '<polyline fill="none" points="' + tp + '" stroke="#26241F" stroke-width="1.5"/>' : '') + '</svg>';
}
export interface ItemRanking extends ItemBarra { series: number[]; tr: number | null }
/** Ranking con minigráfico diario y tendencia. */
export function ranking(el: HTMLElement, items: ItemRanking[], escapar: (s: string) => string, lim?: number) {
  const max = Math.max(1, ...items.map((i) => i.v)), show = lim ? items.slice(0, lim) : items;
  el.innerHTML = show.length ? '<div class="rk-h"><span></span><span></span><span>Pedidos</span><span>Tendencia diaria</span></div>' + show.map((i) => '<div class="rk"><div class="rk-l"><b>' + escapar(i.l) + '</b>' + (i.s ? '<span>' + i.s + '</span>' : '') + '</div><div class="vb-t"><i style="width:' + Math.max(i.v ? 1 : 0, i.v / max * 100) + '%;background:' + (i.c || 'var(--blue)') + '"></i></div><div class="vb-n">' + fmtInt(i.v) + (i.p != null ? '<span>' + i.p + '%</span>' : '') + '</div><div class="rk-t">' + miniTendencia(i.series, i.c) + tendenciaEtiqueta(i.tr) + '</div></div>').join('') + (lim && items.length > lim ? '<p class="q" style="margin-top:8px">y ' + (items.length - lim) + ' más…</p>' : '') : '<p class="q">Sin datos en el periodo.</p>';
}
