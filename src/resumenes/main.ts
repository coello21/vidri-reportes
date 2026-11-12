/**
 * Resúmenes del Radar por día, semana y mes (como las pestañas del radar viejo), con los días guardados en Supabase.
 * Solo lee: preparadas, negadas y líneas cerradas son las mismas del Radar (meta de cada día). Las tarjetas
 * (Líneas preparadas, Negadas, Fill rate) y los gráficos usan las mismas funciones del Radar.
 */
import '../app/radar.css';
import '../app/estilos.css';
import './resumenes.css';
import * as XLSX from 'xlsx';
import { crearCliente, iniciarSesion, quitarPantalla, cargando } from '../app/sesion';
import { conReintentos, enParalelo } from '../nube/base';
import { fillRateCD } from '../core/negados/motivos';
import { lineasPreparadas } from '../core/negados/extras';
import type { Historial, StoreRadar } from '../core/negados/tipos';
import { tendenciaSobrePuntos, globoEnPuntos } from '../app/ui/graficos';
import { fmtDateShort } from '../app/ui/formato';
import { aviso, descargar } from '../app/ui/avisos';
import { fmtInt, fmtPct, esc, normText } from '../app/ui/formato';
import { MESES_CORTO, DIAS_CORTO, diaSemana } from '../core/comun/fechas';

interface Dia {
  fecha: string; prep: number; neg: number; tot: number; parcial: boolean;
  z: number | null;                         // negadas de pedidos en cero (mot.z), para el fill rate
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
let REVN: Record<string, number> = {};      // líneas entregadas al revisador por día (tarjeta "Líneas preparadas")

/* ---------------- lectura ---------------- */
async function leer(sb: ReturnType<typeof crearCliente>) {
  cargando('Leyendo los días guardados…');
  const st = await conReintentos(async () => { const r = await sb.from('radar_store').select('skus:data->skus,covered:data->covered,revN:data->revN').eq('id', 1).maybeSingle(); if (r.error) throw r.error; return r.data as { skus: typeof SKUS; covered: string[]; revN: Record<string, number> } | null; });
  SKUS = st?.skus || {};
  REVN = st?.revN || {};
  const cubiertos = new Set(st?.covered || []);
  const fechas = await conReintentos(async () => { const r = await sb.from('radar_dias').select('fecha').order('fecha'); if (r.error) throw r.error; return (r.data || []).map((x) => x.fecha as string); });
  const lotes: string[][] = [];
  for (let i = 0; i < fechas.length; i += 8) lotes.push(fechas.slice(i, i + 8));
  let hechos = 0;
  const partes = await enParalelo(lotes.map((l) => async () => {
    const r = await conReintentos(async () => {
      const q = await sb.from('radar_dias').select('fecha,v:data->v,meta:data->meta,codes:data->codes,ps:data->prepSkus,preps:data->preps,z:data->mot->z').in('fecha', l);
      if (q.error) throw q.error; return q.data || [];
    });
    hechos++; cargando('Leyendo los días guardados… ' + Math.round(hechos / lotes.length * 100) + '%');
    return r;
  }), 4);
  DIAS = partes.flat().map((r: any) => {
    const m = r.meta || {}, neg = m.totalNegados || 0, tot = m.totalFinal || 0;
    const codes: Record<string, number> = {};
    for (const k in r.codes || {}) { const a = r.codes[k]; const n = Array.isArray(a) ? a.reduce((x: number, y: number) => x + (y || 0), 0) : +a || 0; if (n) codes[k] = n; }
    const prepCods = new Set<string>(), preps = new Set<string>(Object.keys(r.preps || {}));
    for (const p in r.ps || {}) { preps.add(p); for (const k in r.ps[p]) prepCods.add(k); }
    return { fecha: r.fecha, prep: m.totalPreparados != null ? m.totalPreparados : Math.max(tot - neg, 0), neg, tot, parcial: +r.v === 2 && !cubiertos.has(r.fecha), z: r.z == null ? null : +r.z, codes, prepCods, preps };
  }).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
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
  $('tDia').querySelectorAll<HTMLElement>('tr[data-f]').forEach((tr) => tr.addEventListener('click', () => { elegirDia(tr.dataset.f!); $('selCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $('nDia').textContent = DIAS.length + ' días';
  const P = DIAS.reduce((a, d) => a + d.prep, 0), N = DIAS.reduce((a, d) => a + d.neg, 0), T = DIAS.reduce((a, d) => a + d.tot, 0);
  $('kDia').innerHTML = kpi('Días en el histórico', fmtInt(DIAS.length), DIAS.length ? corto(DIAS[0].fecha) + ' – ' + corto(DIAS[DIAS.length - 1].fecha) : '') +
    kpi('Total preparadas', fmtInt(P), '<b>' + pct(P, T) + '</b> del total de líneas', 'prep') +
    kpi('Total negadas', fmtInt(N), '<b>' + pct(N, T) + '</b> del total de líneas', 'neg') +
    kpi('Total líneas', fmtInt(T), 'promedio <b>' + fmtInt(DIAS.length ? T / DIAS.length : 0) + '</b> por día');
}
const kpi = (l: string, v: string, f: string, cls = '') => `<div class="kpi"><div class="lbl">${l}</div><div class="val tabular ${cls}">${v}</div><div class="foot">${f}</div></div>`;

/* ---------------- tarjetas del Radar: Líneas preparadas, Negadas, Fill rate ---------------- */
function tarjetasRadar(dias: Dia[]) {
  if (!dias.length) return '';
  const desde = dias[0].fecha, hasta = dias[dias.length - 1].fecha;
  const H: Historial = {};
  dias.forEach((d) => { H[d.fecha] = { v: 2, meta: { totalFinal: d.tot, totalNegados: d.neg, totalPreparados: d.prep }, ...(d.z != null ? { mot: { z: d.z } } : {}) } as unknown as Historial[string]; });
  const f = fillRateCD(H, dias.map((d) => d.fecha));
  const lp = lineasPreparadas({ revN: REVN } as unknown as StoreRadar, desde, hasta);
  const ini = Object.keys(REVN).sort()[0];
  const tot = dias.reduce((a, d) => a + d.tot, 0), neg = dias.reduce((a, d) => a + d.neg, 0);
  const lpFoot = lp == null ? 'se registra desde el ' + (ini ? corto(ini) : '—') : ini && desde < ini ? 'solo desde el ' + corto(ini) + ' (antes no se registraba)' : 'entregadas al revisador';
  return kpi('Líneas preparadas', lp == null ? '—' : fmtInt(lp), lpFoot) +
    kpi('Líneas negadas', fmtInt(neg), '<b>' + pct(neg, tot) + '</b> de ' + fmtInt(tot) + ' líneas cerradas', 'neg') +
    kpi('Fill rate', f.pct != null ? fmtPct(f.pct) : '—', f.base ? '<b>' + fmtInt(f.prep) + '</b> de ' + fmtInt(f.base) + ' líneas' : 'Sin líneas cerradas');
}

/* ---------------- Por día: día elegido ---------------- */
let DIA_SEL = '';
function pintarDia() {
  const d = DIAS.find((x) => x.fecha === DIA_SEL) || DIAS[DIAS.length - 1];
  if (!d) return;
  DIA_SEL = d.fecha;
  ($('selDia') as HTMLSelectElement).value = d.fecha;
  $('kSel').innerHTML = tarjetasRadar([d]);
  $('selSub').textContent = largoDia(d.fecha) + (d.parcial ? ' · día en curso' : '');
  document.querySelectorAll<HTMLElement>('#tDia tr[data-f]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.f === d.fecha));
}
function elegirDia(f: string) { DIA_SEL = f; pintarDia(); }

/* ---------------- Negados vs Preparados (mismo gráfico del Radar) ---------------- */
function negPrepHtml(id: string) {
  return `<div class="chart full"><div class="cardhead"><div><h3>Negados vs Preparados</h3><p class="cardsub">Líneas negadas frente a líneas sí preparadas (cantidad preparada &gt; 0) del período, y tendencia por día</p></div></div>
    <div class="negprep-compare">
      <div class="negprep-row negado"><span class="label">Negados</span><div class="track"><div class="fill" id="${id}FN"></div></div><span class="val tabular" id="${id}VN">—</span></div>
      <div class="negprep-row preparado"><span class="label">Preparados</span><div class="track"><div class="fill" id="${id}FP"></div></div><span class="val tabular" id="${id}VP">—</span></div>
    </div>
    <div class="negprep-trend-wrap"><div class="negprep-trend-head"><span class="legend-item negado"><span class="sw"></span>Negados</span><span class="legend-item preparado"><span class="sw"></span>Preparados</span></div>
      <div class="spark-wrap" id="${id}W"><svg id="${id}S" viewBox="0 0 900 160" preserveAspectRatio="none"></svg><div class="spark-tip" id="${id}T"></div></div></div></div>`;
}
function negPrep(id: string, dias: Dia[]) {
  const neg = dias.reduce((a, d) => a + d.neg, 0), prep = dias.reduce((a, d) => a + d.prep, 0), total = Math.max(neg + prep, 1), max = Math.max(neg, prep, 1);
  $(id + 'FN').style.width = Math.max(3, neg / max * 100) + '%';
  $(id + 'FP').style.width = Math.max(3, prep / max * 100) + '%';
  $(id + 'VN').innerHTML = '<b>' + fmtInt(neg) + '</b>' + fmtPct(neg / total * 100);
  $(id + 'VP').innerHTML = '<b>' + fmtInt(prep) + '</b>' + fmtPct(prep / total * 100);
  const svg = $(id + 'S') as unknown as SVGSVGElement, W = 900, H = 160, pad = 22;
  const pts0 = dias.map((d) => ({ date: d.fecha, neg: d.neg, prep: d.prep }));
  if (pts0.length < 2) {
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '<text x="' + W / 2 + '" y="' + (H / 2 + 4) + '" text-anchor="middle" font-size="12" fill="var(--ink-muted)" font-family="var(--font-body)">Hace falta más de un día para ver la tendencia</text>';
    return;
  }
  const mx = Math.max(...pts0.map((p) => Math.max(p.neg, p.prep)), 1);
  const xAt = (i: number) => pad + i / (pts0.length - 1) * (W - 2 * pad), yAt = (v: number) => H - pad - (v / mx) * (H - 2 * pad - 16);
  const path = (k: 'neg' | 'prep') => pts0.map((p, i) => (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(p[k]).toFixed(1)).join(' ');
  let grid = '';
  for (let g = 0; g <= 2; g++) { const y = pad + g * (H - 2 * pad - 16) / 2; grid += '<line x1="' + pad + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad) + '" y2="' + y.toFixed(1) + '" stroke="var(--border)" stroke-width="1"/>'; }
  const idx = pts0.length <= 8 ? pts0.map((_, i) => i) : [0, Math.round((pts0.length - 1) / 2), pts0.length - 1];
  const labels = idx.map((i) => '<text x="' + xAt(i).toFixed(1) + '" y="' + (H - 4) + '" font-size="9.5" fill="var(--ink-muted)" text-anchor="middle" font-family="var(--font-mono)">' + fmtDateShort(pts0[i].date) + '</text>').join('');
  const dots = (k: 'neg' | 'prep', col: string) => pts0.map((p, i) => '<circle class="np-dot" data-kind="' + k + '" data-date="' + p.date + '" data-v="' + p[k] + '" cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(p[k]).toFixed(1) + '" r="3.4" fill="var(--surface)" stroke="' + col + '" stroke-width="1.8"/>').join('');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.innerHTML = grid + '<path d="' + path('prep') + '" fill="none" stroke="var(--good)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<path d="' + path('neg') + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots('neg', 'var(--accent)') + dots('prep', 'var(--good)') + labels;
  const parcial = new Set(dias.filter((d) => d.parcial).map((d) => d.fecha));
  globoEnPuntos(svg, $(id + 'W'), $(id + 'T'), '.np-dot', W, H, (c) =>
    fmtDateShort(c.getAttribute('data-date')!) + ' — ' + fmtInt(+c.getAttribute('data-v')!) + ' ' + (c.getAttribute('data-kind') === 'neg' ? 'negados' : 'preparados'));
  tendenciaSobrePuntos(svg, '.np-dot', (d) => parcial.has(d), 'data-kind');
}

const SEL: Record<string, string> = {};
function tablaGrupos(tipo: 'semana' | 'mes', tabla: string, cuenta: string, det: string) {
  const G = agrupar(tipo);
  if (!SEL[tipo] && G.length) SEL[tipo] = G[0].clave;
  $(tabla).innerHTML = '<thead><tr><th>' + (tipo === 'semana' ? 'Semana' : 'Mes') + '</th><th class="n">Días con datos</th><th class="n">Preparadas</th><th class="n">Negadas</th><th class="n">Total líneas</th><th class="n">% negado</th><th>Distribución</th></tr></thead><tbody>' +
    G.map((g) => `<tr data-c="${g.clave}" class="${g.clave === SEL[tipo] ? 'sel' : ''}"><td><b>${esc(g.titulo)}</b><small>${esc(g.sub)}</small></td><td class="n mut">${g.dias.length} de ${g.posibles}</td><td class="n prep">${fmtInt(g.prep)}</td><td class="n neg">${fmtInt(g.neg)}</td><td class="n">${fmtInt(g.tot)}</td><td class="n">${pct(g.neg, g.tot)}</td><td>${barra(g.prep, g.neg)}</td></tr>`).join('') + '</tbody>';
  $(tabla).querySelectorAll<HTMLElement>('tr[data-c]').forEach((tr) => tr.addEventListener('click', () => { SEL[tipo] = tr.dataset.c!; tablaGrupos(tipo, tabla, cuenta, det); $(det).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $(cuenta).textContent = G.length + (tipo === 'semana' ? ' semanas' : (G.length === 1 ? ' mes' : ' meses'));
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
  const C = codigosDe(g), nom = tipo === 'semana' ? 'la semana' : 'el mes';
  $(det).innerHTML = `<div class="chart full"><div class="cardhead"><div><h3>Detalle de ${nom}: ${esc(g.titulo)}</h3><p class="cardsub">${esc(g.sub)} · ${g.dias.length} días con datos de ${g.posibles}</p></div>
    <div class="rs-pick"><select id="sel-${tipo}">${G.map((x) => `<option value="${x.clave}"${x.clave === g.clave ? ' selected' : ''}>${esc(x.titulo + ' · ' + x.sub)}</option>`).join('')}</select></div></div>
    <section class="kpis rs-kpis">${tarjetasRadar(g.dias)}${kpi('Preparadores', fmtInt(C.preps), 'con actividad en ' + g.dias.length + ' días')}</section></div>
    ${negPrepHtml('np-' + tipo)}
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
  negPrep('np-' + tipo, g.dias);
  ($('bc-' + tipo) as HTMLInputElement).addEventListener('input', (e) => { BUSCA[tipo] = (e.target as HTMLInputElement).value; pinta(); });
  ($('sel-' + tipo) as HTMLSelectElement).addEventListener('change', (e) => { SEL[tipo] = (e.target as HTMLSelectElement).value; render(); });
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
  });
}
arrancar().catch((e) => { console.error(e); aviso('err', 'No se pudo abrir: ' + ((e as Error)?.message || 'error'), 30000); });
