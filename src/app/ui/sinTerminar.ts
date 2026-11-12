/**
 * Curva de "Pedidos sin terminar" hora por hora (Pedidos CD), comparada con el mismo día de la semana anterior.
 * La usan el Radar (Pedidos CD) y la página de Resúmenes, para que se dibuje igual en las dos.
 */
import type { PedidosCD } from '../../core/pedidos/cd';
import { sumarDiasUTC, diaSemana, DIAS_CORTO, DIAS_LARGO } from '../../core/comun/fechas';
import { fmtInt, etiquetaDia } from './formato';
import { nice, corto } from './graficos';

const dowL = (d: string) => DIAS_LARGO[diaSemana(d)];

export function dibujarSinTerminar(A: ReturnType<PedidosCD['avance']>, ref: string, el: HTMLElement, leg: HTMLElement, tit: HTMLElement) {
  const n = A.n;
  const hs = A.horas, v1 = A.sinTerminar, hp = A.horasSemanaPasada, v0 = A.sinTerminarSemanaPasada, prev = A.prev;
  const W = Math.max(300, el.clientWidth || 900), Ht = 250, m = { l: 50, r: 84, t: 14, b: 30 }, iw = W - m.l - m.r, ih = Ht - m.t - m.b, maxH = hs[hs.length - 1] || 1;
  const max = nice(Math.max(1, ...v1, ...(v0 || [0]))), x = (h: number) => m.l + h / maxH * iw, y = (v: number) => m.t + ih - v / max * ih;
  let g = '';
  for (let q = 0; q <= 4; q++) { const v = max * q / 4, yy = y(v).toFixed(1); g += '<line class="gl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/><text class="ax" x="' + (m.l - 8) + '" y="' + (+yy + 3.5) + '" text-anchor="end">' + corto(v) + '</text>'; }
  for (let dd = 0; dd * 24 <= maxH; dd++) { const xx = x(dd * 24).toFixed(1), dn = sumarDiasUTC(ref, dd); g += '<line x1="' + xx + '" x2="' + xx + '" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="#CFC6B1"/><text class="ax' + (dd === 0 ? ' pk' : '') + '" x="' + (+xx + 4) + '" y="' + (Ht - 10) + '">' + DIAS_CORTO[diaSemana(dn)] + ' ' + (+dn.slice(8)) + '</text>'; }
  const line = (vals: number[] | null, hh: number[], col: string, dash: boolean, lab: string) => {
    if (!vals || !vals.length) return '';
    let o = '<polyline fill="none" stroke="' + col + '" stroke-width="2.2"' + (dash ? ' stroke-dasharray="6 4"' : '') + ' points="' + vals.map((v, i) => x(hh[i]).toFixed(1) + ',' + y(v).toFixed(1)).join(' ') + '"/>';
    vals.forEach((v, i) => { o += '<circle cx="' + x(hh[i]).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="6" fill="transparent"><title>' + lab + ' · ' + DIAS_LARGO[diaSemana(sumarDiasUTC(ref, Math.floor(hh[i] / 24)))] + ' ' + String(hh[i] % 24).padStart(2, '0') + ':00 → ' + fmtInt(v) + ' sin terminar</title></circle>'; });
    const li = vals.length - 1;
    return o + '<text class="lb" x="' + (x(hh[li]) + 6).toFixed(1) + '" y="' + (y(vals[li]) + 4).toFixed(1) + '" fill="' + col + '">' + fmtInt(vals[li]) + '</text>';
  };
  g += line(v0, hp, '#A3A5A8', true, dowL(prev) + ' ' + etiquetaDia(prev)) + line(v1, hs, '#E0262B', false, dowL(ref) + ' ' + etiquetaDia(ref));
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + Ht + '" height="' + Ht + '" role="img">' + g + '</svg>';
  leg.innerHTML = '<span><i style="background:#E0262B"></i>' + dowL(ref) + ' ' + etiquetaDia(ref) + ' (' + fmtInt(n) + ' pedidos)</span>' +
    (A.nSemanaPasada ? '<span><i class="dash"></i>' + dowL(prev) + ' ' + etiquetaDia(prev) + ' (' + fmtInt(A.nSemanaPasada) + ' pedidos), misma hora</span>' : '');
  const dur = (h: number) => (h < 48 ? Math.round(h) + ' horas' : (h / 24).toFixed(1).replace('.', ',') + ' días');
  if (A.horasParaTerminar != null) {
    tit.textContent = 'Los pedidos del ' + dowL(ref) + ' ' + etiquetaDia(ref) + ' se terminaron en ' + dur(A.horasParaTerminar) + (A.horasParaTerminarSemanaPasada != null ? '; los del ' + dowL(prev) + ' anterior tardaron ' + dur(A.horasParaTerminarSemanaPasada) : '');
    return;
  }
  tit.textContent = A.quedabanSemanaPasada == null || !A.nSemanaPasada
    ? 'Quedan ' + fmtInt(A.quedan) + ' pedidos del ' + dowL(ref) + ' sin terminar'
    : 'Quedan ' + fmtInt(A.quedan) + ' pedidos del ' + dowL(ref) + ' sin terminar; a esta misma altura la semana pasada quedaban ' + fmtInt(A.quedabanSemanaPasada);
}
