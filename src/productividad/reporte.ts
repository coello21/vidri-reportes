/**
 * Reporte ejecutivo de Productividad por zona (una página, para guardar en PDF).
 * Mismo formato que el "Resumen · Productividad por zona" del reporte ejecutivo del Radar:
 * todas las órdenes del día, las de varias zonas aparte, total por zona contra su meta.
 */
import { Productividad, horas } from '../core/productividad/calculo';
import { GLOBAL } from '../core/productividad/listado';

const DIA = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
const MES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEPT', 'OCT', 'NOV', 'DIC'];
const c1 = (v: number | null | undefined) => (v == null || !isFinite(v) ? '–' : v.toFixed(1).replace('.', ','));
const c0 = (v: number) => Math.round(v).toLocaleString('en-US');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const COL = { g: '#2E7D4F', y: '#C46A1E', r: '#C0392B' } as const;
const est = (v: number, m: number, t: number): keyof typeof COL => (v >= m ? 'g' : v >= m - t ? 'y' : 'r');
const hora = (seg: number) => { const d = new Date(seg * 1000); let h = d.getHours(); const ap = h < 12 ? 'a. m.' : 'p. m.'; h = h % 12 || 12; return h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap; };

/** Último día con órdenes (o el elegido si el rango es un solo día). */
export function diaDelReporte(P: Productividad, d1: string, d2: string): string | null {
  if (d1 && d1 === d2) return d1;
  let max = '';
  for (const o of P.db.values()) if (o[5] > max && (!d2 || o[5] <= d2)) max = o[5];
  return max || null;
}

export function armarReporte(P: Productividad, dia: string, logo: string): { html: string; titulo: string } {
  const Z = P.vistaZonas({ sec: 'zon', flt: 'all', d1: dia, d2: dia, zsel: '', zAll: true });
  let corte = 0;
  for (const o of P.db.values()) if (o[5] === dia && o[8] != null && o[8] > corte) corte = o[8];
  let vo = 0, vk = 0, vh = 0, vp = 0;
  for (const p of Z.personas) { const c = p.z['Varias zonas']; if (c) { vo += c.o; vk += c.k; vh += horas(c); vp++; } }
  const vr = vh ? vk / vh : null;
  const S = Z.S.filter((s) => s.tot != null);
  const en = S.filter((s) => s.tot! >= s.mt.m), bajo = S.filter((s) => s.tot! < s.mt.m);
  const peor = bajo.length ? bajo.reduce((a, b) => (b.h > a.h ? b : a)) : null;
  const sobre = en.filter((s) => s.h >= 3).sort((a, b) => b.tot! / b.mt.m - a.tot! / a.mt.m).slice(0, 3);
  const rZ = Z.rZ ?? 0, meta = GLOBAL.m, gap = meta - rZ;
  const f = new Date(dia + 'T12:00:00'), fecha = DIA[f.getDay()] + ' ' + f.getDate() + ' ' + MES[f.getMonth()] + ' ' + f.getFullYear();
  const hc = corte ? hora(corte) : '—', hcCorta = hc.split(' ')[0];
  const tit = `Hasta las ${hcCorta} el CD va en ${c1(rZ)} líneas por hora, ${c1(Math.abs(gap))} ${gap > 0 ? 'bajo' : 'sobre'} la meta; ${en.length} de ${S.length} zonas cumplen` + (peor ? ` y la ${peor.z} es la que más horas va abajo` : '');
  const lead = `Con las órdenes auditadas hasta las ${hcCorta} se prepararon ${c0(Z.tk)} líneas en ${c1(Z.th)} h (${Z.ordenes} órdenes de una zona, ${Z.nP} personas). ` +
    (sobre.length ? `Las que más superan su meta: ${sobre.map((s) => `${s.z} (${c1(s.tot)} vs ${s.mt.m})`).join(', ')}. ` : '') +
    (bajo.length ? `Bajo meta: ${bajo.slice().sort((a, b) => b.h - a.h).map((s) => `${s.z} ${c1(s.tot)} vs ${s.mt.m}`).join(', ')}. ` : '') +
    `Las ${vo} órdenes de varias zonas van aparte: ${c1(vr)} por hora.`;
  // escala de las barras sin las zonas con muy pocas horas (un valor extremo aplastaría las demás); lo que se pasa se recorta al 100%
  const mx = Math.max(...S.filter((s) => s.h >= 0.5).map((s) => Math.max(s.tot!, s.mt.m)), ...S.map((s) => s.mt.m)) * 1.05;
  let filas = '';
  for (const s of S) {
    const k = est(s.tot!, s.mt.m, s.mt.t), ka = est(s.avg ?? 0, s.mt.m, s.mt.t);
    filas += `<tr><td class="l"><b>${esc(s.z)}</b></td><td>${s.n}</td><td>${s.o}</td><td>${c0(s.k)}</td><td>${c1(s.h)}</td><td style="color:${COL[ka]}">${c1(s.avg)}</td>` +
      `<td class="bar"><div class="b"><span style="width:${Math.min(100, s.tot! / mx * 100).toFixed(1)}%;background:${COL[k]}"></span><i style="left:${(s.mt.m / mx * 100).toFixed(1)}%"></i></div></td><td><b style="color:${COL[k]}">${c1(s.tot)}</b></td><td class="m">${s.mt.m}</td></tr>`;
  }
  filas += `<tr class="vz"><td class="l"><b>Varias zonas</b> <span class="mut">(aparte)</span></td><td>${vp}</td><td>${vo}</td><td>${c0(vk)}</td><td>${c1(vh)}</td><td></td><td class="mut l" style="font-size:7pt">— no entran en el total por zona</td><td><b>${c1(vr)}</b></td><td class="m">—</td></tr>`;
  const titulo = 'Productividad por zona · ' + fecha.toLowerCase();
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
@page{size:Letter;margin:0}
*{box-sizing:border-box}body{margin:0;background:#F6F1E7;font-family:'IBM Plex Sans','DejaVu Sans',Arial,sans-serif;color:#1F1D1A;font-size:8.6pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar-top{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px 14px;background:#1F1D1A}.bar-top button{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.05em;text-transform:uppercase;padding:7px 12px;border:1px solid #fff;border-radius:4px;background:#fff;color:#1F1D1A;cursor:pointer}.bar-top button+button{background:transparent;color:#fff}
@media print{.bar-top{display:none}}
.pg{max-width:216mm;margin:0 auto;padding:12mm 13mm;min-height:279mm;position:relative;background:#F6F1E7}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #C8102E;padding-bottom:7px}
.hd img{height:34px}.hr{text-align:right;font-family:'IBM Plex Mono',monospace;font-size:7pt;letter-spacing:.06em;color:#6B665D;line-height:1.6}.hr b{color:#1F1D1A}
.eb{font-family:'IBM Plex Mono',monospace;font-size:7pt;letter-spacing:.1em;color:#857F73;margin:12px 0 3px;text-transform:uppercase}
h1{font-family:'Newsreader',Georgia,serif;font-size:15pt;line-height:1.22;margin:0 0 6px}
.lead{color:#3F3B35;line-height:1.45;margin:0 0 10px}
.k{display:flex;gap:8px;margin-bottom:12px}.kp{flex:1;background:#FBF8F2;border:1px solid #E2DBCC;border-radius:4px;padding:7px 10px}
.kp .l{font-family:'IBM Plex Mono',monospace;font-size:6.5pt;letter-spacing:.08em;color:#857F73;text-transform:uppercase}.kp .v{font-family:'Newsreader',Georgia,serif;font-size:19pt;margin:2px 0}.kp .s{font-size:7pt;color:#4A463F}
.sec{font-family:'IBM Plex Mono',monospace;font-size:7pt;letter-spacing:.1em;color:#C8102E;text-transform:uppercase;margin:4px 0}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th{font-family:'IBM Plex Mono',monospace;font-size:6.3pt;letter-spacing:.05em;color:#6B665D;text-transform:uppercase;text-align:right;padding:3px 5px;border-bottom:1.3px solid #1F1D1A}th.l,td.l{text-align:left}
td{padding:3px 5px;border-bottom:1px solid #E6DFD1;text-align:right}td.m{color:#857F73}
td.bar{width:30%}.b{position:relative;height:9px;background:#ECE5D6}.b span{display:block;height:100%}.b i{position:absolute;top:-2px;bottom:-2px;width:1.5px;background:#1F1D1A}
tr.vz td{border-top:1.3px solid #1F1D1A;color:#4A463F}.mut{color:#857F73}
.leg{font-size:7pt;color:#6B665D;margin-top:4px}
.nota{position:absolute;bottom:12mm;left:13mm;right:13mm;font-family:'IBM Plex Mono',monospace;font-size:6.3pt;color:#857F73;border-top:1px solid #D9D1C1;padding-top:5px;line-height:1.5}
</style></head><body>
<div class="bar-top"><button id="pdf" type="button">Guardar PDF</button><button id="cerrar" type="button">Cerrar</button></div>
<div class="pg">
<div class="hd"><img src="${logo}" alt="Vidri"><div class="hr">RESUMEN · PRODUCTIVIDAD POR ZONA<br><b>${fecha} · CORTE ${hc.toUpperCase()}</b><br>TODAS LAS ÓRDENES · FUENTE: AUDITORÍA DE PREPARACIÓN</div></div>
<div class="eb">Líneas preparadas por hora por zona</div>
<h1>${esc(tit)}</h1>
<p class="lead">${esc(lead)}</p>
<div class="k">
<div class="kp"><div class="l">Líneas por hora · general</div><div class="v" style="color:${COL[est(rZ, meta, GLOBAL.t)]}">${c1(rZ)}</div><div class="s">${c0(Z.tk)} líneas ÷ ${c1(Z.th)} h · meta global ${meta}</div></div>
<div class="kp"><div class="l">Zonas en meta (total)</div><div class="v">${en.length} de ${S.length}</div><div class="s">bajo meta: ${bajo.map((s) => esc(s.z.replace('Zona ', 'Z'))).join(', ') || 'ninguna'}</div></div>
<div class="kp"><div class="l">Zona con más horas bajo meta</div><div class="v" style="color:${COL.y}">${peor ? esc(peor.z) : '—'}</div><div class="s">${peor ? `${c1(peor.tot)} vs ${peor.mt.m} con ${c1(peor.h)} h · ${peor.n} personas` : ''}</div></div>
<div class="kp"><div class="l">Varias zonas (aparte)</div><div class="v">${c1(vr)}</div><div class="s">${vo} órdenes · ${c0(vk)} líneas · ${vp} personas</div></div>
</div>
<div class="sec">Resumen por zona</div>
<table><tr><th class="l">Zona</th><th>Personas</th><th>Órdenes</th><th>Líneas</th><th>Horas</th><th>Promedio de las personas</th><th class="l">Total vs meta (marca negra)</th><th>Total (líneas ÷ h)</th><th>Meta</th></tr>${filas}</table>
<div class="leg">Total = líneas ÷ horas de toda la zona. Promedio = promedio simple de la productividad de cada persona en la zona. Verde: en meta o arriba · naranja: dentro de la tolerancia · rojo: más abajo.</div>
<div class="nota">Mismas exclusiones del tablero: órdenes de 1 SKU, menos de 10 s por SKU y más de 4 h · Horas por bloques de tiempo (órdenes simultáneas se cuentan una vez) · Día = fecha del primer código preparado · Incluye todos los tipos de pedido · Varias zonas: órdenes con más de una zona; no entran en el total ni se reparten por zona.</div>
</div>
<script>document.getElementById("pdf").onclick=function(){window.print()};document.getElementById("cerrar").onclick=function(){try{parent.__cerrarReporteProd()}catch(e){window.close()}};<\/script>
</body></html>`;
  return { html, titulo };
}

/** Muestra el reporte encima de la página (con botones Guardar PDF y Cerrar). */
export function mostrarReporte(doc: { html: string; titulo: string }) {
  document.getElementById('rep-ov')?.remove();
  const ov = document.createElement('div'); ov.id = 'rep-ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(38,36,31,.55);display:flex';
  const fr = document.createElement('iframe'); fr.title = doc.titulo; fr.style.cssText = 'flex:1;border:0;background:#d9d1c1';
  ov.appendChild(fr); document.body.appendChild(ov);
  (window as unknown as { __cerrarReporteProd: () => void }).__cerrarReporteProd = () => { ov.remove(); document.body.style.overflow = ''; };
  document.body.style.overflow = 'hidden';
  fr.srcdoc = doc.html;
}
