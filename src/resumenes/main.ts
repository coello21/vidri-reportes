/**
 * Resúmenes del Radar por día, semana y mes (como las pestañas del radar viejo), con los días guardados en Supabase.
 * Solo lee: preparadas, negadas y líneas cerradas son las mismas del Radar (meta de cada día).
 * Tarjetas: Total preparadas, Total negadas y Fill rate (mismo cálculo del Radar); en semana y mes, promedio por día.
 */
import '../app/radar.css';
import '../app/estilos.css';
import './resumenes.css';
import * as XLSX from 'xlsx';
import { crearCliente, iniciarSesion, quitarPantalla, cargando } from '../app/sesion';
import { conReintentos, enParalelo } from '../nube/base';
import { fillRateCD } from '../core/negados/motivos';
import type { Historial } from '../core/negados/tipos';
import { nice, corto as cortoNum } from '../app/ui/graficos';
import { aviso, descargar } from '../app/ui/avisos';
import { fmtInt, fmtPct, esc, normText } from '../app/ui/formato';
import { MESES_CORTO, DIAS_CORTO, diaSemana, sumarDiasUTC } from '../core/comun/fechas';

interface Dia {
  fecha: string; prep: number; neg: number; tot: number; parcial: boolean;
  z: number | null;                         // negadas de pedidos en cero (mot.z), para el fill rate
  hist: boolean;                            // día de historial (versión liviana: sin códigos preparados)
  det: boolean;                             // ya se leyó su detalle (se lee solo al ver su semana o mes)
  codes: Record<string, number>;            // código → veces negado
  prepCods: Set<string>;                    // códigos preparados
  preps: Set<string>;                       // preparadores con actividad
}
interface Grupo { clave: string; titulo: string; sub: string; dias: Dia[]; posibles: number; prep: number; neg: number; tot: number }

const $ = (id: string) => document.getElementById(id)!;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const D = (s: string) => new Date(s + 'T12:00:00');
const iso = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const corto = (s: string) => +s.slice(8) + ' ' + MESES_CORTO[+s.slice(5, 7) - 1];
const largoDia = (s: string) => DIAS_CORTO[diaSemana(s)] + ', ' + +s.slice(8) + ' ' + MESES_CORTO[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4);
const pct = (a: number, b: number) => (b ? fmtPct(a / b * 100) : '—');

/** Semana ISO (lunes a domingo): número y lunes. */
function semana(s: string): { n: number; anio: number; lunes: string } {
  const d = D(s), dow = (d.getDay() + 6) % 7, lun = new Date(d); lun.setDate(d.getDate() - dow);
  const j = new Date(lun); j.setDate(lun.getDate() + 3);              // jueves de esa semana
  const y = j.getFullYear(), e = new Date(y, 0, 4), e0 = new Date(e); e0.setDate(e.getDate() - ((e.getDay() + 6) % 7));
  return { n: 1 + Math.round((lun.getTime() - e0.getTime()) / (7 * 864e5)), anio: y, lunes: iso(lun) };
}

let DIAS: Dia[] = [];
let SKUS: Record<string, [string, ...unknown[]]> = {};

/* ---------------- lectura ---------------- */
async function leer(sb: ReturnType<typeof crearCliente>) {
  cargando('Leyendo los días guardados…');
  const st = await conReintentos(async () => { const r = await sb.from('radar_store').select('skus:data->skus,covered:data->covered').eq('id', 1).maybeSingle(); if (r.error) throw r.error; return r.data as { skus: typeof SKUS; covered: string[] } | null; });
  SKUS = st?.skus || {};
  const cubiertos = new Set(st?.covered || []);
  SB = sb;
  // al abrir solo los totales de cada día (liviano); el detalle de códigos se lee al ver una semana o un mes
  const SEL_DIA = 'fecha,v:data->v,meta:data->meta,z:data->mot->z,hist:data->hist';
  const [filas, hist] = await Promise.all([
    conReintentos(async () => { const q = await sb.from('radar_dias').select(SEL_DIA).order('fecha').limit(5000); if (q.error) throw q.error; return q.data || []; }),
    // historial (antes del 24-ago) en su propia tabla, que el Radar no lee; si todavía no existe, se sigue sin él
    sb.from('radar_hist').select(SEL_DIA).order('fecha').limit(5000).then((q) => (q.error ? [] : q.data || []), () => []),
  ]);
  const ya = new Set(filas.map((r: any) => r.fecha));
  filas.push(...hist.filter((r: any) => !ya.has(r.fecha)));
  filas.sort((a: any, b: any) => (a.fecha < b.fecha ? -1 : 1));
  DIAS_HIST = new Set(hist.map((r: any) => r.fecha as string));
  DIAS = filas.map((r: any) => {
    const m = r.meta || {}, neg = m.totalNegados || 0, tot = m.totalFinal || 0, hist = +r.hist === 1;
    return { fecha: r.fecha, prep: m.totalPreparados != null ? m.totalPreparados : Math.max(tot - neg, 0), neg, tot, parcial: +r.v === 2 && !hist && !cubiertos.has(r.fecha), z: r.z == null ? null : +r.z, hist, det: false, codes: {}, prepCods: new Set<string>(), preps: new Set<string>() };
  });
}
let SB: ReturnType<typeof crearCliente>;
let DIAS_HIST = new Set<string>();          // días que vienen de radar_hist
/** Lee el detalle (códigos negados, códigos preparados, preparadores) de los días que todavía no lo tienen. */
async function cargarDetalle(dias: Dia[]) {
  const falta = dias.filter((d) => !d.det), por = new Map(falta.map((d) => [d.fecha, d]));
  const lotes: string[][] = [];
  for (const L of [falta.filter((d) => DIAS_HIST.has(d.fecha)), falta.filter((d) => !DIAS_HIST.has(d.fecha))])
    for (let i = 0; i < L.length; i += 8) lotes.push(L.slice(i, i + 8).map((d) => d.fecha));
  const partes = await enParalelo(lotes.map((l) => () => conReintentos(async () => {
    const q = await SB.from(DIAS_HIST.has(l[0]) ? 'radar_hist' : 'radar_dias').select('fecha,codes:data->codes,ps:data->prepSkus,preps:data->preps').in('fecha', l);
    if (q.error) throw q.error; return q.data || [];
  })), 4);
  partes.flat().forEach((r: any) => {
    const d = por.get(r.fecha); if (!d) return;
    for (const k in r.codes || {}) { const a = r.codes[k]; const n = Array.isArray(a) ? a.reduce((x: number, y: number) => x + (y || 0), 0) : +a || 0; if (n) d.codes[k] = n; }
    Object.keys(r.preps || {}).forEach((p) => d.preps.add(p));
    for (const p in r.ps || {}) { d.preps.add(p); for (const k in r.ps[p]) d.prepCods.add(k); }
    d.det = true;
  });
}

/* ---------------- grupos ---------------- */
function agrupar(tipo: 'semana' | 'mes'): Grupo[] {
  const M = new Map<string, Grupo>();
  for (const d of DIAS) {
    let clave: string, titulo: string, sub: string, posibles: number;
    if (tipo === 'semana') {
      const w = semana(d.fecha), dom = D(w.lunes); dom.setDate(dom.getDate() + 6);
      clave = w.anio + '-S' + String(w.n).padStart(2, '0'); titulo = 'Semana ' + w.n;
      sub = corto(w.lunes) + ' – ' + corto(iso(dom)) + ' ' + iso(dom).slice(0, 4); posibles = 7;
    } else {
      const y = +d.fecha.slice(0, 4), mo = +d.fecha.slice(5, 7), fin = new Date(y, mo, 0).getDate();
      clave = d.fecha.slice(0, 7); titulo = MESES[mo - 1].charAt(0).toUpperCase() + MESES[mo - 1].slice(1) + ' de ' + y;
      sub = '1 ' + MESES_CORTO[mo - 1] + ' – ' + fin + ' ' + MESES_CORTO[mo - 1]; posibles = fin;
    }
    const g = M.get(clave) || M.set(clave, { clave, titulo, sub, dias: [], posibles, prep: 0, neg: 0, tot: 0 }).get(clave)!;
    g.dias.push(d); g.prep += d.prep; g.neg += d.neg; g.tot += d.tot;
  }
  return [...M.values()].sort((a, b) => (a.clave < b.clave ? 1 : -1));
}

/* ---------------- tablas ---------------- */
const barra = (p: number, n: number) => { const t = p + n; return t ? `<span class="rs-bar"><i style="width:${(p / t * 100).toFixed(1)}%"></i><b style="width:${(n / t * 100).toFixed(1)}%"></b></span>` : ''; };
const ORD: Record<string, { k: string; asc: boolean }> = { dia: { k: 'fecha', asc: false } };

function tablaDias() {
  const o = ORD.dia, L = DIAS.slice().sort((a: any, b: any) => { const x = a[o.k], y = b[o.k]; const r = x < y ? -1 : x > y ? 1 : 0; return o.asc ? r : -r; });
  const col = (k: string, t: string, cls = 'n') => `<th class="${cls}" data-k="${k}">${t}${o.k === k ? (o.asc ? ' ▲' : ' ▼') : ''}</th>`;
  $('tDia').innerHTML = '<thead><tr>' + col('fecha', 'Fecha', '') + col('prep', 'Preparadas') + col('neg', 'Negadas') + col('tot', 'Total líneas') + '<th class="n">% prep.</th><th class="n">% negado</th><th>Distribución</th></tr></thead><tbody>' +
    L.map((d) => `<tr data-f="${d.fecha}" class="${d.fecha === DIA_SEL ? 'sel' : ''}"><td>${largoDia(d.fecha)}${d.parcial ? ' <span class="rs-pc">en curso</span>' : ''}</td><td class="n prep">${fmtInt(d.prep)}</td><td class="n neg">${fmtInt(d.neg)}</td><td class="n">${fmtInt(d.tot)}</td><td class="n">${pct(d.prep, d.tot)}</td><td class="n">${pct(d.neg, d.tot)}</td><td>${barra(d.prep, d.neg)}</td></tr>`).join('') + '</tbody>';
  $('tDia').querySelectorAll<HTMLElement>('th[data-k]').forEach((th) => th.addEventListener('click', () => { const k = th.dataset.k!; ORD.dia = { k, asc: o.k === k ? !o.asc : k === 'fecha' ? false : false }; tablaDias(); }));
  $('tDia').querySelectorAll<HTMLElement>('tr[data-f]').forEach((tr) => tr.addEventListener('click', () => { elegirDia(tr.dataset.f!); $('tab-dia').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $('nDia').textContent = DIAS.length + ' días';
}
const kpi = (l: string, v: string, f: string, cls = '') => `<div class="kpi"><div class="lbl">${l}</div><div class="val tabular ${cls}">${v}</div><div class="foot">${f}</div></div>`;

/* ---------------- tarjetas: Total preparadas, Total negadas, Fill rate ---------------- */
/** Días para el promedio: sin el día en curso (está a medias y bajaría el promedio), salvo que sea el único. */
const paraPromedio = (dias: Dia[]) => { const u = DIAS[DIAS.length - 1], L = u && u.parcial ? dias.filter((d) => d !== u) : dias; return L.length ? L : dias; };
function tarjetas(dias0: Dia[], promedio: boolean) {
  const dias = promedio ? paraPromedio(dias0) : dias0;
  const n = dias.length || 1, P = dias.reduce((a, d) => a + d.prep, 0), N = dias.reduce((a, d) => a + d.neg, 0), T = dias.reduce((a, d) => a + d.tot, 0);
  const H: Historial = {};
  dias.forEach((d) => { H[d.fecha] = { v: 2, meta: { totalFinal: d.tot, totalNegados: d.neg, totalPreparados: d.prep }, ...(d.z != null ? { mot: { z: d.z } } : {}) } as unknown as Historial[string]; });
  const f = fillRateCD(H, dias.map((d) => d.fecha));
  const v = (x: number) => fmtInt(promedio ? Math.round(x / n) : x);
  const sinHoy = promedio && dias.length < dias0.length;
  const pie = (x: number) => '<b>' + pct(x, T) + '</b>' + (promedio ? ' · promedio por día' : ' de las líneas');
  return kpi('Total preparadas', v(P), pie(P), 'prep') +
    kpi('Total negadas', v(N), pie(N), 'neg') +
    kpi('Fill rate', f.pct != null ? fmtPct(f.pct) : '—', sinHoy ? 'sin el día en curso' : '');
}

/* ---------------- gráfico: preparadas y negadas en líneas; discontinua = período anterior ---------------- */
interface Punto { k?: string; prep: number; neg: number; parcial?: boolean; tip: string }
interface Eje { l1: string; l2: string }
function grafico(el: HTMLElement, X: Eje[], A: (Punto | null)[], P: (Punto | null)[], sel: number, alClic?: (k: string) => void) {
  const W = Math.max(300, el.clientWidth || 900), H = 250, m = { l: 46, r: 12, t: 10, b: 36 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = X.length;
  const vals = [...A, ...P].filter((x): x is Punto => !!x).flatMap((x) => [x.prep, x.neg]);
  const max = nice(Math.max(1, ...vals)), slot = iw / Math.max(1, n);
  const cx = (i: number) => m.l + slot * i + slot / 2, y = (v: number) => m.t + ih - (v / max) * ih;
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 46))));
  let g = '';
  for (let q = 0; q <= 4; q++) { const v = max * q / 4, yy = y(v).toFixed(1); g += '<line class="gl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + yy + '" y2="' + yy + '"/><text class="ax" x="' + (m.l - 8) + '" y="' + (+yy + 3.5) + '" text-anchor="end">' + cortoNum(v) + '</text>'; }
  if (sel >= 0) g += '<rect x="' + (cx(sel) - slot / 2).toFixed(1) + '" y="' + m.t + '" width="' + slot.toFixed(1) + '" height="' + ih + '" fill="var(--surface-2)"/>';
  // une los días con datos (domingos y feriados sin datos no cortan la línea)
  const linea = (S: (Punto | null)[], k: 'prep' | 'neg', col: string, dash: boolean) => {
    let o = '', tramo: string[] = [];  // eslint-disable-line prefer-const
    const fin = () => { if (tramo.length > 1) o += '<polyline fill="none" stroke="' + col + '" stroke-width="' + (dash ? 1.8 : 2.2) + '"' + (dash ? ' stroke-dasharray="6 4" opacity=".55"' : '') + ' stroke-linejoin="round" points="' + tramo.join(' ') + '"/>'; tramo = []; };
    S.forEach((p, i) => { if (p) tramo.push(cx(i).toFixed(1) + ',' + y(p[k]).toFixed(1)); });
    fin();
    if (!dash) S.forEach((p, i) => { if (p) o += '<circle cx="' + cx(i).toFixed(1) + '" cy="' + y(p[k]).toFixed(1) + '" r="' + (i === sel ? 4.6 : 3.4) + '" fill="' + (i === sel ? col : 'var(--surface)') + '" stroke="' + col + '" stroke-width="1.8" opacity="' + (p.parcial ? 0.5 : 1) + '"/>'; });
    return o;
  };
  g += linea(P, 'prep', 'var(--good)', true) + linea(P, 'neg', 'var(--accent)', true) + linea(A, 'prep', 'var(--good)', false) + linea(A, 'neg', 'var(--accent)', false);
  X.forEach((e, i) => {
    const a = A[i], p = P[i], tip = [a ? a.tip + '\nPreparadas: ' + fmtInt(a.prep) + ' · Negadas: ' + fmtInt(a.neg) : '', p ? p.tip + '\nPreparadas: ' + fmtInt(p.prep) + ' · Negadas: ' + fmtInt(p.neg) : ''].filter(Boolean).join('\n\n');
    if (tip) g += '<g' + (alClic && a?.k ? ' class="clk" data-k="' + a.k + '"' : '') + '><title>' + esc(tip) + '</title><rect x="' + (cx(i) - slot / 2).toFixed(1) + '" y="' + m.t + '" width="' + slot.toFixed(1) + '" height="' + ih + '" fill="transparent"/></g>';
    if (i % step === 0 || i === n - 1) g += '<text class="ax' + (i === sel ? ' pk' : '') + '" x="' + cx(i).toFixed(1) + '" y="' + (H - 22) + '" text-anchor="middle">' + esc(e.l1) + '</text><text class="ax" x="' + cx(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(e.l2) + '</text>';
  });
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img">' + g + '</svg>';
  if (alClic) el.querySelectorAll<SVGGElement>('g.clk').forEach((x) => x.addEventListener('click', () => alClic(x.dataset.k!)));
}
const leyenda = (act: string, ant: string) => '<span><i style="background:var(--good)"></i>Preparadas</span><span><i style="background:var(--accent)"></i>Negadas</span>' +
  '<span>— ' + esc(act) + '</span><span>- - ' + esc(ant) + '</span>';
const POR_FECHA = () => new Map(DIAS.map((d) => [d.fecha, d]));
const punto = (d: Dia | undefined, tip: string): Punto | null => (d ? { k: d.fecha, prep: d.prep, neg: d.neg, parcial: d.parcial, tip } : null);
/** Semana de lunes a domingo del lunes dado frente a la semana anterior. */
function graficoSemana(el: HTMLElement, leg: HTMLElement, tit: HTMLElement, lunes: string, sel: string, alClic?: (k: string) => void) {
  const F = POR_FECHA(), w = semana(lunes), wp = semana(sumarDiasUTC(lunes, -7));
  const X: Eje[] = [], A: (Punto | null)[] = [], P: (Punto | null)[] = [];
  for (let i = 0; i < 7; i++) {
    const d = sumarDiasUTC(lunes, i), dp = sumarDiasUTC(lunes, i - 7);
    X.push({ l1: DIAS_CORTO[diaSemana(d)], l2: corto(d) });
    A.push(punto(F.get(d), largoDia(d))); P.push(punto(F.get(dp), largoDia(dp)));
  }
  tit.textContent = 'Semana ' + w.n + ' vs semana ' + wp.n;
  leg.innerHTML = leyenda('Semana ' + w.n, 'Semana ' + wp.n);
  grafico(el, X, A, P, X.findIndex((_, i) => sumarDiasUTC(lunes, i) === sel), alClic);
}
/** Todas las semanas o todos los meses: promedio por día de cada uno (sin el día en curso), el elegido resaltado. */
function graficoGrupos(tipo: 'semana' | 'mes', el: HTMLElement, leg: HTMLElement, tit: HTMLElement, G: Grupo[], sel: string, alClic: (k: string) => void) {
  const X: Eje[] = [], A: (Punto | null)[] = [];
  G.forEach((x) => {
    const L = paraPromedio(x.dias), n = L.length || 1;
    X.push(tipo === 'semana' ? { l1: 'S' + x.titulo.replace('Semana ', ''), l2: x.sub.split(' – ')[0] } : { l1: MESES_CORTO[+x.clave.slice(5, 7) - 1], l2: x.clave.slice(0, 4) });
    A.push({ k: x.clave, prep: Math.round(L.reduce((a, d) => a + d.prep, 0) / n), neg: Math.round(L.reduce((a, d) => a + d.neg, 0) / n), tip: x.titulo + ' · ' + x.sub + ' · promedio por día' });
  });
  tit.textContent = tipo === 'semana' ? 'Semanas de ' + nombreMes(jueves(G[0])).toLowerCase() : 'Meses de ' + G[0].clave.slice(0, 4);
  leg.innerHTML = '<span><i style="background:var(--good)"></i>Preparadas</span><span><i style="background:var(--accent)"></i>Negadas</span>';
  grafico(el, X, A, [], G.findIndex((x) => x.clave === sel), alClic);
}

/* ---------------- Por día ---------------- */
let DIA_SEL = '';
function pintarDia() {
  const d = DIAS.find((x) => x.fecha === DIA_SEL) || DIAS[DIAS.length - 1];
  if (!d) return;
  DIA_SEL = d.fecha;
  ($('selDia') as HTMLSelectElement).value = d.fecha;
  $('kSel').innerHTML = tarjetas([d], false);
  document.querySelectorAll<HTMLElement>('#tDia tr[data-f]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.f === d.fecha));
  graficoSemana($('gDia'), $('gDiaLeg'), $('gDiaT'), semana(d.fecha).lunes, d.fecha, elegirDia);
}
function elegirDia(f: string) { DIA_SEL = f; pintarDia(); }

const SEL: Record<string, string> = {};
const PER: Record<string, string> = {};     // mes (en semanas) o año (en meses) del selector
/** Mes de una semana: el de su jueves (así una semana que cruza de mes queda en el mes donde tiene más días). */
const jueves = (x: Grupo) => sumarDiasUTC(semana(x.dias[0].fecha).lunes, 3);
const nombreMes = (k: string) => { const s = MESES[+k.slice(5, 7) - 1]; return s.charAt(0).toUpperCase() + s.slice(1) + ' de ' + k.slice(0, 4); };
function tablaGrupos(tipo: 'semana' | 'mes', tabla: string, cuenta: string, det: string) {
  const G = agrupar(tipo);
  if (!SEL[tipo] && G.length) SEL[tipo] = G[0].clave;
  $(tabla).innerHTML = '<thead><tr><th>' + (tipo === 'semana' ? 'Semana' : 'Mes') + '</th><th class="n">Días con datos</th><th class="n">Preparadas</th><th class="n">Negadas</th><th class="n">Total líneas</th><th class="n">% negado</th><th>Distribución</th></tr></thead><tbody>' +
    G.map((g) => `<tr data-c="${g.clave}" class="${g.clave === SEL[tipo] ? 'sel' : ''}"><td><b>${esc(g.titulo)}</b><small>${esc(g.sub)}</small></td><td class="n mut">${g.dias.length} de ${g.posibles}</td><td class="n prep">${fmtInt(g.prep)}</td><td class="n neg">${fmtInt(g.neg)}</td><td class="n">${fmtInt(g.tot)}</td><td class="n">${pct(g.neg, g.tot)}</td><td>${barra(g.prep, g.neg)}</td></tr>`).join('') + '</tbody>';
  $(tabla).querySelectorAll<HTMLElement>('tr[data-c]').forEach((tr) => tr.addEventListener('click', () => { SEL[tipo] = tr.dataset.c!; PER[tipo] = ''; tablaGrupos(tipo, tabla, cuenta, det); $(det).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $(cuenta).textContent = G.length + (tipo === 'semana' ? ' semanas' : (G.length === 1 ? ' mes' : ' meses'));
  // selector: en semanas, el mes (sus semanas); en meses, el año (sus meses)
  const per = (x: Grupo) => (tipo === 'semana' ? jueves(x).slice(0, 7) : x.clave.slice(0, 4));
  const opciones = [...new Set(G.map(per))];                      // del más reciente al más viejo
  if (!PER[tipo] || !opciones.includes(PER[tipo])) PER[tipo] = per(G.find((x) => x.clave === SEL[tipo]) || G[0]);
  const sl = $('sel-' + tipo) as HTMLSelectElement;
  sl.innerHTML = opciones.map((o) => `<option value="${o}"${o === PER[tipo] ? ' selected' : ''}>${esc(tipo === 'semana' ? nombreMes(o) : o)}</option>`).join('');
  const GP = G.filter((x) => per(x) === PER[tipo]).reverse();      // del período, en orden
  if (!GP.some((x) => x.clave === SEL[tipo]) && GP.length) SEL[tipo] = GP[GP.length - 1].clave;
  const g = G.find((x) => x.clave === SEL[tipo]);
  $('s-' + tipo).textContent = g ? g.titulo + ' · ' + g.sub : '';
  $('k-' + tipo).innerHTML = g ? tarjetas(g.dias, true) : '';
  if (g) graficoGrupos(tipo, $('g-' + tipo), $('l-' + tipo), $('t-' + tipo), GP, g.clave, (k) => { SEL[tipo] = k; tablaGrupos(tipo, tabla, cuenta, det); });
  $(tabla).querySelectorAll<HTMLElement>('tr[data-c]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.c === SEL[tipo]));
  detalle(tipo, G, det);
}

const BUSCA: Record<string, string> = {};
function codigosDe(g: Grupo) {
  const veces = new Map<string, number>(), dias = new Map<string, number>(), prep = new Set<string>(), preps = new Set<string>();
  for (const d of g.dias) {
    for (const k in d.codes) { veces.set(k, (veces.get(k) || 0) + d.codes[k]); dias.set(k, (dias.get(k) || 0) + 1); }
    d.prepCods.forEach((k) => prep.add(k)); d.preps.forEach((p) => preps.add(p));
  }
  const L = [...veces].map(([k, v]) => ({ sku: k, desc: String(SKUS[k]?.[0] || ''), veces: v, dias: dias.get(k) || 0 })).sort((a, b) => b.veces - a.veces || b.dias - a.dias || (a.sku < b.sku ? -1 : 1));
  return { L, prep: prep.size, preps: preps.size };
}
function detalle(tipo: 'semana' | 'mes', G: Grupo[], det: string) {
  const g = G.find((x) => x.clave === SEL[tipo]);
  if (!g) { $(det).innerHTML = ''; return; }
  const nom = tipo === 'semana' ? 'la semana' : 'el mes';
  if (g.dias.some((d) => !d.det)) {
    $(det).innerHTML = '<div class="chart full"><div class="cardhead"><div><h3>Detalle de ' + nom + ': ' + esc(g.titulo) + '</h3><p class="cardsub">Cargando…</p></div></div></div>';
    cargarDetalle(g.dias).then(() => { if (SEL[tipo] === g.clave) detalle(tipo, G, det); }).catch((e) => { console.error(e); $(det).querySelector('.cardsub')!.textContent = 'No se pudo leer el detalle: ' + ((e as Error)?.message || 'error'); });
    return;
  }
  const C = codigosDe(g), sinPrep = g.dias.some((d) => d.hist);
  $(det).innerHTML = `<div class="chart full"><div class="cardhead"><div><h3>Detalle de ${nom}: ${esc(g.titulo)}</h3><p class="cardsub">${esc(g.sub)} · ${g.dias.length} días con datos de ${g.posibles}</p></div>
</div>
    <section class="kpis rs-kpis">${kpi('Preparadas', fmtInt(g.prep), sinPrep ? '' : '<b>' + fmtInt(C.prep) + '</b> códigos distintos', 'prep')}${kpi('Negadas', fmtInt(g.neg), '<b>' + fmtInt(C.L.length) + '</b> códigos distintos', 'neg')}${kpi('Total líneas', fmtInt(g.tot), '<b>' + pct(g.neg, g.tot) + '</b> negado')}${kpi('Preparadores', fmtInt(C.preps), 'con actividad en ' + g.dias.length + ' días')}</section></div>
    <div class="chart full tablecard"><div class="cardhead"><div><h3>Códigos negados de ${nom}</h3><p class="cardsub">Cuántas veces se negó cada código y en cuántos días distintos. El Excel incluye todos los códigos.</p></div><button class="btn" id="xc-${tipo}" type="button">Descargar Excel</button></div>
    <div class="rs-search"><input type="text" id="bc-${tipo}" placeholder="Buscar código o descripción…" value="${esc(BUSCA[tipo] || '')}"></div>
    <div class="tablescroll rs-scroll"><table class="rs-t" id="tc-${tipo}"></table></div><div class="table-meta"><span id="nc-${tipo}"></span><span>Ordenado por veces negado</span></div></div>`;
  const pinta = () => {
    const q = normText(BUSCA[tipo] || ''), L = q ? C.L.filter((x) => normText(x.sku).includes(q) || normText(x.desc).includes(q)) : C.L;
    $('tc-' + tipo).innerHTML = '<thead><tr><th>Código</th><th>Descripción</th><th class="n">Veces negado</th><th class="n">Días negado</th></tr></thead><tbody>' +
      L.slice(0, 500).map((x) => `<tr><td class="mono">${esc(x.sku)}</td><td>${esc(x.desc)}</td><td class="n"><b>${fmtInt(x.veces)}</b></td><td class="n mut">${x.dias}</td></tr>`).join('') + '</tbody>';
    $('nc-' + tipo).textContent = fmtInt(L.length) + ' códigos' + (L.length > 500 ? ' (mostrando 500)' : '');
  };
  pinta();
  ($('bc-' + tipo) as HTMLInputElement).addEventListener('input', (e) => { BUSCA[tipo] = (e.target as HTMLInputElement).value; pinta(); });
  $('xc-' + tipo).addEventListener('click', () => excel('Codigos_negados_' + g.clave, 'Códigos', ['Código', 'Descripción', 'Veces negado', 'Días negado'], C.L.map((x) => [x.sku, x.desc, x.veces, x.dias])));
}

/* ---------------- Excel ---------------- */
function excel(nombre: string, hoja: string, enc: string[], filas: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet([enc, ...filas]);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: enc.length - 1 } }) };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, hoja);
  descargar(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombre + '.xlsx');
  aviso('ok', 'Descargando ' + nombre + '.xlsx');
}
function excelGrupos(tipo: 'semana' | 'mes') {
  const G = agrupar(tipo);
  excel('Resumen_por_' + tipo, tipo === 'semana' ? 'Por semana' : 'Por mes', [tipo === 'semana' ? 'Semana' : 'Mes', 'Fechas', 'Días con datos', 'Preparadas', 'Negadas', 'Total líneas', '% negado'],
    G.map((g) => [g.titulo, g.sub, g.dias.length + ' de ' + g.posibles, g.prep, g.neg, g.tot, g.tot ? Math.round(g.neg / g.tot * 1000) / 10 : 0]));
}

/* ---------------- pestañas ---------------- */
function render() {
  tablaDias();
  tablaGrupos('semana', 'tSem', 'nSem', 'dSem');
  tablaGrupos('mes', 'tMes', 'nMes', 'dMes');
}
function pestana(t: string) {
  const v = ['dia', 'semana', 'mes'].includes(t) ? t : 'dia';
  document.querySelectorAll<HTMLAnchorElement>('#vxNav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === v));
  ['dia', 'semana', 'mes'].forEach((x) => { $('tab-' + x).hidden = x !== v; });
  if (DIAS.length) { render(); pintarDia(); }      // los gráficos se dibujan con el ancho de la pestaña visible
}

async function arrancar() {
  const sb = crearCliente();
  await iniciarSesion(sb, async (s) => {
    await leer(sb);
    quitarPantalla();
    $('usuario').textContent = s.user?.email || '';
    const ult = DIAS[DIAS.length - 1];
    $('rsActual').textContent = ult ? 'Último día: ' + corto(ult.fecha) + (ult.parcial ? ' (en curso)' : '') : 'Sin datos';
    DIA_SEL = ult ? ult.fecha : '';
    ($('selDia') as HTMLSelectElement).innerHTML = DIAS.slice().reverse().map((d) => `<option value="${d.fecha}">${esc(largoDia(d.fecha))}${d.parcial ? ' (en curso)' : ''}</option>`).join('');
    ($('selDia') as HTMLSelectElement).addEventListener('change', (e) => elegirDia((e.target as HTMLSelectElement).value));
    render();
    pintarDia();
    document.querySelectorAll<HTMLAnchorElement>('#vxNav a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', '#' + a.dataset.tab); pestana(a.dataset.tab || ''); }));
    pestana(location.hash.slice(1));
    $('xDia').addEventListener('click', () => excel('Resumen_por_dia', 'Por día', ['Fecha', 'Preparadas', 'Negadas', 'Total líneas', '% prep.', '% negado'],
      DIAS.slice().reverse().map((d) => [d.fecha, d.prep, d.neg, d.tot, d.tot ? Math.round(d.prep / d.tot * 1000) / 10 : 0, d.tot ? Math.round(d.neg / d.tot * 1000) / 10 : 0])));
    $('xSem').addEventListener('click', () => excelGrupos('semana'));
    $('xMes').addEventListener('click', () => excelGrupos('mes'));
    (['semana', 'mes'] as const).forEach((t) => ($('sel-' + t) as HTMLSelectElement).addEventListener('change', (e) => { PER[t] = (e.target as HTMLSelectElement).value; SEL[t] = ''; render(); }));
  });
}
arrancar().catch((e) => { console.error(e); aviso('err', 'No se pudo abrir: ' + ((e as Error)?.message || 'error'), 30000); });
