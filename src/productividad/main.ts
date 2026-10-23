/**
 * Productividad de preparación (versión nueva). Mismos cálculos y pestañas que la página original,
 * con el diseño del Radar y los datos en Supabase.
 */
import '../app/radar.css';
import '../app/estilos.css';
import './prod.css';
import { Productividad, FILTROS, estado, estadoBalanceo, fmt as f, type Opciones, type Seccion, type Filtro, type FilaPersona } from '../core/productividad/calculo';
import { GLOBAL, MAX_HORAS, MIN_SEG, metaZona, clave, semana as semanaDe, type Meta, type Persona } from '../core/productividad/listado';
import { leerAuditoria, type Orden } from '../core/productividad/parseo';
import { lineas, barrasZona, PALETA } from './graficos';
import { aviso, descargar } from '../app/ui/avisos';
import type { BaseProductividad } from '../nube/productividad';

const COPIA = import.meta.env.MODE === 'copia';
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const DI = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const addD = (d: string, n: number) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const fd = (d: string, y?: boolean) => { const p = d.split('-'); return +p[2] + ' ' + MES[+p[1] - 1] + (y ? ' ' + p[0] : ''); };
const mn_ = (m: Meta) => (m.n === 'Global' ? 'Meta global' : 'Meta ' + m.n);
const gap = (r: number | null, m: Meta) => (r == null ? 'sin datos' : Math.abs(r - m.m) < 0.05 ? 'justo en la meta' : f(Math.abs(r - m.m)) + (r >= m.m ? ' sobre la meta' : ' por debajo de la meta'));

/* ---------------- estado de la pantalla ---------------- */
const S = { sec: 'retail' as Seccion, flt: 'all' as Filtro, zsel: '', zAll: false, sk: 'rate', asc: false, tmode: 'w' as 'w' | 'd', sel: new Set<string>() };
let P = new Productividad();
let base: BaseProductividad | null = null;
let ultimas: string[] = []; // personas de la tabla, en orden (para los colores del gráfico)

const opciones = (): Opciones => ({ sec: S.sec, flt: S.flt, d1: ($('d1') as HTMLSelectElement).value, d2: ($('d2') as HTMLSelectElement).value, zsel: S.zsel, zAll: S.zAll });
const colores = () => { const LP = new Set(ultimas), m = new Map<string, string>(); [...S.sel].filter((k) => LP.has(k)).forEach((k, i) => m.set(k, PALETA[i % 8])); return m; };

function kpi(lbl: string, val: string, foot: string, cls = '', st = '') {
  return '<div class="kpi' + (cls ? ' ' + cls : '') + '"><div class="lbl">' + lbl + '</div><div class="val tabular' + (st ? ' pv-' + st : '') + '">' + val + '</div><div class="foot">' + foot + '</div></div>';
}
type Col = [string, string, string, string?];
function tabla(cols: Col[], filas: string, vacio: string) {
  $('th').innerHTML = cols.map((c) => `<th class="${c[2]}" data-k="${c[0]}"${c[3] ? ` title="${c[3]}"` : ''}>${c[1]}${S.sk === c[0] ? (S.asc ? ' ▲' : ' ▼') : ''}</th>`).join('');
  $('th').querySelectorAll<HTMLElement>('th').forEach((t) => t.addEventListener('click', () => {
    const k = t.dataset.k!; if (k === 'sel' || k === 'add') return;
    S.asc = S.sk === k ? !S.asc : ['name', 'type', 'cod', 'zona', 'zonas'].includes(k); S.sk = k; render();
  }));
  $('tb').innerHTML = filas || `<tr><td colspan="${cols.length}" class="empty">${vacio}</td></tr>`;
}
const pill = (v: number | null, st: string, pocas = false, title = '') => `<b class="pill ${st}" style="${pocas ? 'opacity:.55' : ''}"${title ? ` title="${title}"` : ''}>${f(v)}</b>`;

/* ---------------- fechas ---------------- */
let firma = '';
function fechas() {
  const ds = P.dias(), sg = ds.join();
  if (sg !== firma) {
    firma = sg;
    const lb = (d: string) => { const p = d.split('-'); return DI[new Date(d + 'T12:00:00').getDay()] + ' ' + (+p[2]) + ' ' + MES[+p[1] - 1] + ' ' + p[0]; };
    for (const [id, t] of [['d1', 'Desde el inicio'], ['d2', 'Hasta el final']]) {
      const e = $(id) as HTMLSelectElement, cur = e.value;
      e.innerHTML = `<option value="">${t}</option>` + ds.map((d) => `<option value="${d}">${lb(d)}</option>`).join(''); e.value = cur;
    }
  }
}
const desdePara = (ds: string[], m: number) => { const fr = addD(ds[ds.length - 1], -(m - 1)); return ds.find((d) => d >= fr) || ds[0]; };
function chipsDias() {
  const el = $('dayChips'), c: Record<string, number> = {};
  for (const o of P.db.values()) c[o[5]] = (c[o[5]] || 0) + 1;
  const ds0 = Object.keys(c).sort();
  if (!ds0.length) { el.innerHTML = ''; return; }
  const L14 = addD(ds0[ds0.length - 1], -13), ds = ds0.filter((d) => d >= L14);
  const d1 = ($('d1') as HTMLSelectElement).value, d2 = ($('d2') as HTMLSelectElement).value, one = d1 && d1 === d2 ? d1 : null, prev = el.scrollLeft, first = !el.dataset.init;
  el.innerHTML = ds.map((d) => { const w = new Date(d + 'T12:00:00').getDay(); return '<button type="button" class="daychip' + (d === one ? ' active' : '') + '" data-date="' + d + '"><span class="d">' + DI[w] + ' ' + (+d.slice(8)) + '-' + MS[+d.slice(5, 7) - 1] + '</span><span class="n">' + c[d].toLocaleString('en-US') + ' <small>órdenes</small></span></button>'; }).join('');
  const on = el.querySelector<HTMLElement>('.daychip.active');
  if (on && (first || on.offsetLeft < prev || on.offsetLeft > prev + el.clientWidth - on.offsetWidth)) el.scrollLeft = on.offsetLeft - el.clientWidth / 2; else el.scrollLeft = first ? el.scrollWidth : prev;
  el.dataset.init = '1';
  const last = ds[ds.length - 1];
  document.querySelectorAll<HTMLElement>('#pvPer button').forEach((b) => { const m = b.dataset.m!; b.classList.toggle('active', m === 'all' ? (!d1 && !d2) : (d2 === last && d1 === desdePara(ds, +m))); });
}
/* ---------------- render ---------------- */
function render() {
  fechas();
  const o = opciones(), zon = S.sec === 'zon', out = S.sec === 'out', zv = S.sec === 'retail' && S.flt === 'exi';
  if (!zv && S.sk === 'zona') { S.sk = 'rate'; S.asc = false; }
  $('ex').innerHTML = '';
  const vacio = !P.db.size;
  document.body.classList.toggle('nodata', vacio);
  $('pv').hidden = vacio;
  if (vacio) { $('sub').textContent = 'Sin datos cargados'; chipsDias(); return; }
  const days = P.dias();
  const emp = ![...P.db.values()].some((x) => (!o.d1 || x[5] >= o.d1) && (!o.d2 || x[5] <= o.d2));
  $('em').hidden = !emp; if (emp) $('em').textContent = 'El rango elegido no tiene órdenes: la fecha “desde” es posterior a la fecha “hasta”. Corrígela o usa “Borrar fechas”.';
  ($('cd') as HTMLButtonElement).disabled = !o.d1 && !o.d2;
  $('ch').hidden = S.sec !== 'retail';
  $('zb').hidden = !zv;
  $('cc').hidden = out || zon || emp;
  $('split').classList.toggle('solo', out || zon || emp);
  $('cz').hidden = !(zon && !emp); $('tz').hidden = !(zon && !emp);
  $('ch').innerHTML = FILTROS.map((x) => `<button class="${S.flt === x[0] ? 'on' : ''}" data-f="${x[0]}">${x[1]}</button>`).join('');
  $('sub').textContent = P.db.size.toLocaleString('es') + ' órdenes cargadas' + (days.length ? ' · preparadas del ' + fd(days[0], true) + ' al ' + fd(days[days.length - 1], true) : '');
  if (zon) renderZonas(o, emp);
  else if (out) renderFuera(o);
  else renderPersonas(o);
  chipsDias();
}

function renderPersonas(o: Opciones) {
  const V = P.vistaPersonas(o);
  if (!V.zselValida) { S.zsel = ''; render(); return; }
  if (V.zv) $('zb').innerHTML = V.zonas.map((x) => `<button class="${S.zsel === x[0] ? 'on' : ''}" data-z="${esc(x[0])}">${x[0] || 'Todas'} <b class="pv-${estado(x[1], metaZona(x[0]))}" title="${'Meta ' + f(metaZona(x[0]).m, 0)}">${f(x[1])}</b></button>`).join('');
  const L = V.filas, mK = V.mK, hM = V.zv || !!V.mS;
  const K = S.sk === 'zona' ? 'zn' : S.sk;
  const val = (p: FilaPersona) => (p as unknown as Record<string, unknown>)[K] as number | string | null;
  L.sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; let d = typeof x === 'string' ? x.localeCompare(y as string, 'es', { numeric: true }) : (x as number) - (y as number); if (!S.asc) d = -d; return d || ((b.rate || 0) - (a.rate || 0)); });
  let bal = '';
  if (V.JR) {
    const B = V.bal;
    bal = kpi('Balanceo de carga ' + V.grp, B ? f(B.val) + '%' : '–', 'meta ≤ 10%' + (B ? ` · uso de capacidad promedio ${f(B.cap, 0)}% · ${B.pers} personas por día · ${B.dias === 1 ? '1 día' : 'promedio de ' + B.dias + ' días'}` : ' · requiere órdenes con hora de escaneo'), 'pv-bal', B ? estadoBalanceo(B.val) : '');
  }
  const stT = estado(V.rT, mK);
  $('kp').innerHTML = kpi('SKUs por hora', f(V.rT), `${f(V.T.k, 0)} SKUs ÷ ${f(V.T.h)} h (todo junto)${mK ? ' · Meta ' + f(mK.m, 0) + ' · ' + ({ g: 'en meta', y: 'en alerta', r: 'por debajo de la alerta' }[stT as 'g'] || '') : ''}`, '', stT) +
    kpi('Promedio por persona', f(V.avg), `Promedio simple de la productividad de cada persona (${V.nPer} personas)${mK ? ' · Meta ' + f(mK.m, 0) : ''}`, '', estado(V.avg, mK)) +
    (mK ? kpi('Meta', f(mK.m, 0), `${mn_(mK)} · el total está ${gap(V.rT, mK)}`) : '') + bal +
    kpi('SKUs preparados', f(V.T.k, 0), 'en las órdenes consideradas') + kpi('Horas de preparación', f(V.T.h), 'bloques de tiempo, sin contar dos veces') + kpi('Órdenes consideradas', f(V.T.o, 0), 'dentro de las reglas fijas');
  ultimas = V.personas.map((p) => p.pk);
  const SC = colores();
  const jcell = (p: FilaPersona) => {
    const j = p.j; if (!j || j.rate == null) return '<td class="dim" title="Sin hora de escaneo (historial anterior)">–</td>';
    const t = `${j.n} ${j.n === 1 ? 'día' : 'días'} · ${f(j.K, 0)} SKUs ÷ ${f(j.H)} h de jornada\n` + j.det.join('\n') + (j.long.length ? '\nJornada de más de 10 h: revisar (¿usuario compartido u orden abierta?)' : '');
    return `<td class="pv-j${j.long.length ? ' jl' : ''}" title="${esc(t)}"><b>${f(j.rate)}</b></td>`;
  };
  const ccell = (p: FilaPersona) => (!p.j || p.j.cap == null ? '<td class="dim">–</td>' : `<td title="SKUs preparados ÷ (meta de la zona × horas de jornada)">${f(p.j.cap, 0)}%</td>`);
  tabla([['sel', '', 'ck'], ['name', 'Preparador', 'l'], ['type', 'Tipo', 'l'], ...(V.zv ? [['zona', 'Zona', 'l'] as Col] : []), ['ord', 'Órd.', '', 'Órdenes consideradas'], ['skus', 'SKUs', ''], ['hrs', 'Horas', ''], ['rate', 'SKUs/h', '', 'SKUs por hora de preparación'], ...(hM ? [['meta', 'Meta', ''] as Col] : []), ...(V.JR ? [['jr', 'SKUs/h jorn.', '', 'SKUs del día ÷ horas entre el primer y el último escaneo del día, menos almuerzo'], ['cap', '% cap.', '', '% de capacidad: SKUs preparados ÷ (meta de la zona × horas de jornada)']] as Col[] : []), ['bad', 'Excl.', '', 'Órdenes excluidas por las reglas fijas']],
    L.map((p) => {
      const col = SC.get(p.pk);
      return `<tr data-pk="${esc(p.pk)}" class="${col ? 'sel' : ''}"><td class="ck"><span class="sw${col ? ' on' : ''}" style="${col ? 'background:' + col + ';border-color:' + col : ''}" role="checkbox" aria-checked="${!!col}" aria-label="Comparar en el gráfico"></span></td><td class="l nm" title="Código ${p.cod ?? '–'}">${esc(p.name)}${p.baja ? ' <span class="tag">(baja)</span>' : ''}</td><td class="l dim">${esc(p.type)}</td>${V.zv ? `<td class="l">${esc(p.zona)}</td>` : ''}<td>${p.ord}</td><td>${f(p.skus, 0)}</td><td>${f(p.hrs, 2)}</td><td>${pill(p.rate, p.st, p.ord < 3, p.ord < 3 ? 'Pocas órdenes: puede no ser representativo' : '')}</td>${hM ? `<td class="dim">${p.meta != null ? f(p.meta, 0) : '–'}</td>` : ''}${V.JR ? jcell(p) + ccell(p) : ''}<td class="dim">${p.bad}</td></tr>`;
    }).join(''), 'No hay órdenes para esta selección.');
  // tendencia
  const T = P.tendencia(o, S.tmode, mK, [...SC.keys()]);
  $('ccsub').textContent = T.sub;
  const nS = SC.size; $('pcount').textContent = nS ? nS + (nS === 1 ? ' persona marcada' : ' personas marcadas') : '';
  ($('clr') as HTMLButtonElement).hidden = !nS;
  lineas($('cv'), T.etiquetas, [
    { nombre: 'Total', datos: T.total, color: '#26241F', grosor: 3 },
    ...(mK ? [{ nombre: mn_(mK) + ' (' + f(mK.m, 0) + ')', datos: T.etiquetas.map(() => mK.m), color: '#3E8E4F', punteada: '7 4', puntos: false }, { nombre: 'Alerta desde ' + f(mK.m - mK.t, 0), datos: T.etiquetas.map(() => mK.m - mK.t), color: '#D49A1E', punteada: '2 4', puntos: false }] : []),
    ...T.personas.map((x) => ({ nombre: x.nombre, datos: x.datos, color: SC.get(x.k)! })),
  ], 'SKUs por hora');
  $('nt').textContent = `Productividad = SKUs preparados ÷ horas de preparación. Las horas van del primer al último SKU preparado de cada orden y se cuentan por bloques de tiempo: si una persona tiene varias órdenes abiertas al mismo tiempo, ese tiempo se cuenta una sola vez. Reglas fijas: quedaron fuera ${V.ex1} órdenes de 1 SKU (sin tiempo medible), ${V.bT} con menos de ${MIN_SEG} s por SKU (escaneo en bloque) y ${V.bL} que superan ${MAX_HORAS} h; estas dos últimas aparecen en la columna Excluidas.` +
    (V.JR ? ` SKUs/h jornada = todos los SKUs del día de la persona (cualquier tipo de pedido) ÷ horas entre su primer y último escaneo del día, descontando el tiempo entre 12:00 y 13:00; en amarillo si algún día pasa de 10 h (pasa el cursor para ver el detalle). % capacidad = horas que tomarían sus SKUs a la meta de cada zona o tipo de pedido ÷ horas de jornada. Balanceo de carga = diferencia promedio entre el % de capacidad de cada persona y el promedio del equipo, por día (personas del listado de ${V.grp} con al menos 1 h de jornada); verde ≤ 10%, amarillo hasta 15%, rojo más.` : '') +
    ' B2B = tipo de pedido con “Venta corporativa”, sin importar el tipo de la persona en el listado; Retail nunca incluye esas órdenes. En Retail, cada orden cae en un solo filtro: Existencia, Rotación, En línea (incluye Vidri Express), Ventas (incluye VTA); lo demás va en Otros. En Existencia cada persona se divide por zona; si una orden trae varias zonas se agrupa (por ejemplo “Zona 1 + Zona 2”) porque su tiempo no se puede repartir. Las cifras en gris tienen menos de 3 órdenes. Colores de meta: verde = en meta o sobre ella; amarillo = hasta 15 códigos por hora por debajo en zonas (5 en ventas y Patio); rojo = más abajo. Donde no hay meta específica (Retail «Todos», Rotación, Otros y zonas sin meta) se usa la meta global de 50 SKUs por hora.';
}

function renderZonas(o: Opciones, emp: boolean) {
  const V = P.vistaZonas(o);
  $('zb').hidden = emp;
  $('zb').innerHTML = ([[false, 'Solo Existencia'], [true, 'Todas las órdenes']] as [boolean, string][]).map((x) => `<button class="${S.zAll === x[0] ? 'on' : ''}" data-za="${x[0] ? 1 : 0}">${x[1]}</button>`).join('');
  $('czT').textContent = 'Líneas preparadas por hora por zona · ' + (S.zAll ? 'todas las órdenes' : 'solo Existencia');
  $('kp').innerHTML = kpi('Líneas por hora', f(V.rZ), `${S.zAll ? 'Todas las órdenes' : 'Solo Existencia'}, sin varias zonas = ${f(V.tk, 0)} líneas ÷ ${f(V.th)} h · Meta global ${f(GLOBAL.m, 0)}`, '', estado(V.rZ, GLOBAL)) +
    kpi('Promedio por persona', f(V.aZ), `Promedio simple de la productividad de cada persona (${V.nP} personas) · Meta global ${f(GLOBAL.m, 0)}`, '', estado(V.aZ, GLOBAL)) +
    kpi('Meta global', f(GLOBAL.m, 0), 'el total está ' + gap(V.rZ, GLOBAL)) + kpi('Zonas con datos', String(V.zs1.length), 'sin contar “varias zonas”') +
    kpi('Órdenes consideradas', f(V.ordenes, 0), V.multi ? `${V.multi} de varias zonas van aparte, solo en la tabla` : 'todas de una sola zona');
  const top = Math.max(...V.S.map((x) => x.avg || 0), 1);
  $('th2').innerHTML = ['Zona|l', 'Personas|', 'Órdenes|', 'Líneas|', 'Horas|', 'Promedio de las personas|', 'Total (líneas ÷ horas)|', 'Meta|'].map((x) => `<th class="${x.split('|')[1]}">${x.split('|')[0]}</th>`).join('');
  $('tb2').innerHTML = V.S.map((x) => `<tr><td class="l"><b>${esc(x.z)}</b></td><td>${x.n}</td><td>${x.o}</td><td>${f(x.k, 0)}</td><td>${f(x.h, 2)}</td><td><div class="pr"><i class="pv-${x.sa}" style="width:${(x.avg || 0) / top * 120}px"></i>${pill(x.avg, x.sa)}</div></td><td>${pill(x.tot, x.sg)}</td><td class="dim">${f(x.mt.m, 0)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No hay órdenes para esta selección.</td></tr>';
  const L = V.personas;
  type PZ = typeof L[number];
  const val = (p: PZ, K: string): number | string | null => K.startsWith('z:') ? (p.z[K.slice(2)] && p.z[K.slice(2)].h ? p.z[K.slice(2)].k / p.z[K.slice(2)].h! : null) : ['name', 'cod', 'type'].includes(K) ? (p as unknown as Record<string, string>)[K] : p.h ? p.k! / p.h : null;
  L.sort((a, b) => { const x = val(a, S.sk), y = val(b, S.sk); if (x == null) return 1; if (y == null) return -1; const d = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number); return S.asc ? d : -d; });
  ultimas = L.map((p) => p.pk);
  tabla([['cod', 'Código', 'l'], ['name', 'Preparador', 'l'], ['type', 'Tipo', 'l'], ...V.zs.map((z) => ['z:' + z, z + '<br><span class="mt">meta ' + f(metaZona(z).m, 0) + '</span>', ''] as Col), ['rate', (S.zAll ? 'Total' : 'Total existencia') + (V.multi ? '<br><span class="mt">sin varias zonas</span>' : ''), '']],
    L.map((p) => `<tr data-pk="${esc(p.pk)}" class="${S.sel.has(p.pk) ? 'sel' : ''}"><td class="l dim">${p.cod ?? '–'}</td><td class="l">${esc(p.name)}${p.baja ? ' <span class="tag">(baja)</span>' : ''}</td><td class="l dim">${esc(p.type)}</td>${V.zs.map((z) => { const c = p.z[z]; return c && c.h ? `<td title="${c.o} órdenes · ${f(c.k, 0)} líneas · ${f(c.h, 2)} h">${pill(c.k / c.h, estado(c.k / c.h, metaZona(z)), c.o < 3)}</td>` : '<td class="dim">–</td>'; }).join('')}<td><b>${f(p.h ? p.k! / p.h : null)}</b></td></tr>`).join(''), 'No hay órdenes para esta selección.');
  const sel = [...S.sel].filter((k) => L.some((p) => p.pk === k));
  barrasZona($('cv2'), V.S.map((x) => ({ etiqueta: x.z, meta: x.mt.m, valores: [{ v: x.avg == null ? null : +x.avg.toFixed(1), color: { g: '#3E8E4F', y: '#D49A1E', r: '#C7453A', '': '#8d8788' }[x.sa], nombre: 'Promedio de las personas' }, ...sel.map((k, i) => { const p = L.find((q) => q.pk === k)!, c = p.z[x.z]; return { v: c && c.h ? +(c.k / c.h).toFixed(1) : null, color: PALETA[i % 8], nombre: p.name }; })] })), GLOBAL.m, sel.map((k, i) => ({ nombre: L.find((q) => q.pk === k)!.name, color: PALETA[i % 8] })));
  ($('clr2') as HTMLButtonElement).hidden = !sel.length;
  $('nt').textContent = `Línea = cada SKU de la orden (columna Total item del reporte); líneas por hora = líneas preparadas ÷ horas de preparación. ${S.zAll ? 'Incluye todas las órdenes: Existencia, Rotación, Ventas, En línea y B2B.' : 'Solo órdenes de Existencia; usa «Todas las órdenes» para ver todos los tipos de pedido.'} Las ${V.multi} órdenes que traen varias zonas no se pueden repartir entre ellas: se muestran aparte, solo en la columna «Varias zonas» de la tabla por preparador (meta global), y no entran en las tarjetas, el gráfico, la tabla por zona ni la columna Total. “Promedio de las personas” es el promedio simple de la productividad de cada persona en esa zona; “Total” es líneas ÷ horas de toda la zona. Las horas se cuentan por bloques de tiempo: si una persona tiene varias órdenes abiertas al mismo tiempo, ese tiempo se cuenta una sola vez. Cifras atenuadas: menos de 3 órdenes (pasa el cursor para ver el detalle). Colores: verde = en meta o sobre ella; amarillo = hasta 15 por debajo (5 en Patio); rojo = más abajo. Se aplican las mismas exclusiones: órdenes de 1 SKU, menos de ${MIN_SEG} s por SKU y más de ${MAX_HORAS} h.`;
}

function renderFuera(o: Opciones) {
  const L = P.vistaFuera(o);
  const K = ({ name: 'name', ord: 'ord', v: 'v', skus: 'skus', hrs: 'hrs', rate: 'rate', a: 'a', b: 'b' } as Record<string, string>)[S.sk] || 'ord';
  L.sort((x, y) => { const u = (x as unknown as Record<string, unknown>)[K] as number | string | null, v = (y as unknown as Record<string, unknown>)[K] as number | string | null; if (u == null) return 1; if (v == null) return -1; const d = typeof u === 'string' ? u.localeCompare(v as string) : (u as number) - (v as number); return S.asc ? d : -d; });
  $('kp').innerHTML = kpi('Fuera del listado', String(L.length), 'nombres del reporte que no están en el listado') + kpi('Órdenes', f(L.reduce((s, p) => s + p.ord, 0), 0), 'de esas personas');
  const puede = !COPIA && !!base;
  tabla([['name', 'Nombre en el reporte', 'l'], ['ord', 'Órdenes', ''], ['v', 'Órdenes válidas', ''], ['skus', 'SKUs', ''], ['hrs', 'Horas', ''], ['rate', 'SKUs por hora', ''], ['meta', 'Meta', ''], ['a', 'Primer pedido', ''], ['b', 'Último pedido', ''], ...(puede ? [['add', 'Agregar al listado', ''] as Col] : [])],
    L.map((p, i) => `<tr><td class="l">${esc(p.name)}</td><td>${p.ord}</td><td>${p.v}</td><td>${f(p.skus, 0)}</td><td>${f(p.hrs, 2)}</td><td>${pill(p.rate, estado(p.rate, GLOBAL))}</td><td class="dim">${f(GLOBAL.m, 0)}</td><td class="dim">${p.a}</td><td class="dim">${p.b}</td>${puede ? `<td class="l ad"><select><option>Retail</option><option>B2B</option><option>Apoyo</option></select><button class="btn" data-add="${i}">Agregar</button></td>` : ''}</tr>`).join(''), 'Todos los nombres del reporte están en el listado.');
  $('nt').textContent = 'Estas personas aparecen como preparador en el reporte y no están en el listado, por eso no entran en Retail ni en B2B.' + (puede ? ' Elige su tipo y pulsa “Agregar”: sus órdenes se cuentan en las productividades, también las de fechas anteriores, y el cambio se guarda en la base para todos.' : ' Para agregarlas, hazlo desde la página.');
  $('tb').querySelectorAll<HTMLButtonElement>('button[data-add]').forEach((b) => b.addEventListener('click', async () => {
    const p = L[+b.dataset.add!], t = (b.parentElement!.querySelector('select') as HTMLSelectElement).value, nueva: Persona = [null, p.name, t, 'Activo'];
    b.disabled = true;
    try { await base!.agregarPersona(nueva); P.extra.push(nueva); P.reconstruir(); aviso('ok', p.name + ' agregado como ' + t + '.'); render(); }
    catch (e) { aviso('err', 'No se pudo guardar: ' + ((e as Error)?.message || 'error'), 15000); b.disabled = false; }
  }));
  $('ex').innerHTML = P.extra.length && puede ? '<b>Personal agregado desde la página:</b> ' + P.extra.map((x, i) => `<span class="px">${esc(x[1])} · ${esc(x[2])}<button data-rm="${i}" title="Quitar">✕</button></span>`).join('') : '';
  $('ex').querySelectorAll<HTMLButtonElement>('button[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    const x = P.extra[+b.dataset.rm!];
    try { await base!.quitarPersona(x[1]); P.extra.splice(+b.dataset.rm!, 1); P.reconstruir(); render(); }
    catch (e) { aviso('err', 'No se pudo guardar: ' + ((e as Error)?.message || 'error'), 15000); }
  }));
}

/* ---------------- eventos ---------------- */
function conectar() {
  document.querySelectorAll<HTMLAnchorElement>('#vxNav a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); ponerSeccion(a.dataset.tab as Seccion); render();
  }));
  $('ch').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return; S.flt = b.dataset.f as Filtro; S.zsel = ''; if (S.flt === 'exi') { S.sk = 'zona'; S.asc = true; } render(); });
  $('zb').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return; if (b.dataset.za != null) S.zAll = b.dataset.za === '1'; else S.zsel = b.dataset.z || ''; render(); });
  $('d1').addEventListener('change', render); $('d2').addEventListener('change', render);
  $('cd').addEventListener('click', () => { ($('d1') as HTMLSelectElement).value = ''; ($('d2') as HTMLSelectElement).value = ''; render(); });
  $('dayChips').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.daychip'); if (!b) return;
    const d = b.dataset.date!, d1 = $('d1') as HTMLSelectElement, d2 = $('d2') as HTMLSelectElement;
    if (d1.value === d && d2.value === d) { d1.value = ''; d2.value = ''; } else { d1.value = d; d2.value = d; }
    render();
  });
  $('pvPer').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    const ds = P.dias(); if (!ds.length) return;
    const d1 = $('d1') as HTMLSelectElement, d2 = $('d2') as HTMLSelectElement;
    if (b.dataset.m === 'all') { d1.value = ''; d2.value = ''; } else { d1.value = desdePara(ds, +b.dataset.m!); d2.value = ds[ds.length - 1]; }
    render();
  });
  $('tmode').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return; S.tmode = b.dataset.m as 'w' | 'd'; $('tmode').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); render(); });
  $('tb').addEventListener('click', (e) => { const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-pk]'); if (!tr) return; const k = tr.dataset.pk!; if (S.sel.has(k)) S.sel.delete(k); else S.sel.add(k); render(); });
  $('clr').addEventListener('click', () => { S.sel.clear(); render(); });
  $('clr2').addEventListener('click', () => { S.sel.clear(); render(); });
  let t: number | undefined;
  window.addEventListener('resize', () => { clearTimeout(t); t = window.setTimeout(render, 200); });
}
function ponerSeccion(s: Seccion) {
  S.sec = ['retail', 'b2b', 'zon', 'out'].includes(s) ? s : 'retail';
  document.querySelectorAll<HTMLAnchorElement>('#vxNav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === S.sec));
  try { history.replaceState(null, '', '#' + S.sec); } catch { /* sin historial */ }
}

/* ---------------- cargar Excel / .json ---------------- */
let ocupado = false;
async function cargarExcel(files: File[]) {
  if (ocupado) return; ocupado = true;
  try {
    const msg: string[] = []; let filas: ReturnType<typeof leerAuditoria> = [];
    for (const fl of files) {
      try {
        const F = leerAuditoria(new Uint8Array(await fl.arrayBuffer()), fl.name);
        if (!F.length) { msg.push(fl.name + ': sin órdenes válidas'); continue; }
        const r = P.integrar(F.map((x) => x.orden)); filas = filas.concat(F);
        msg.push(fl.name + ': ' + r.nuevas.toLocaleString('es') + ' órdenes nuevas, ' + r.actualizadas.toLocaleString('es') + ' actualizadas');
      } catch (e) { aviso('err', (e as Error)?.message || 'No se pudo leer el archivo', 20000); return; }
    }
    render();
    const txt = msg.join(' · ');
    if (!filas.length) { aviso('ok', txt, 15000); return; }
    if (!base) { aviso('ok', txt + (COPIA ? ' · Cargado en esta copia: usa Descargar HTML para guardar un archivo con estos datos.' : ' (modo de prueba: no se guarda).'), 30000); return; }
    aviso('ok', 'Guardando en la base…', 60000);
    const { aFila } = await import('../nube/productividad');
    try {
      await base.guardarOrdenes(filas.map(aFila));
      await base.registrarCarga({ ordenes: filas.length, dias: [...new Set(filas.map((x) => x.orden[5]))].sort() });
      aviso('ok', 'Guardado en la base. ' + txt, 30000);
    } catch (e) { aviso('err', 'Se cargó en pantalla, pero no se pudo guardar en la base: ' + ((e as Error)?.message || 'error') + '. Vuelve a cargar el Excel en un momento.', 40000); }
  } finally { ocupado = false; }
}
async function importarJson(files: File[]) {
  if (!base) { aviso('err', 'Importar historial solo se puede en la página.', 15000); return; }
  const { filaDeOrden } = await import('../nube/productividad');
  let n = 0;
  try {
    for (const fl of files) {
      // .json de la página anterior, o su HTML descargado (los datos van comprimidos adentro)
      const txt = await fl.text();
      let J: { ordenes?: Orden[]; extra?: Persona[] } | null = null;
      if (/\.html?$/i.test(fl.name)) {
        const m = txt.match(/<script type="text\/plain" id="emb">([A-Za-z0-9+/=\s]+)<\/script>/);
        if (!m) throw new Error(fl.name + ' no trae datos de Productividad');
        J = await leerB64(m[1]);
      } else J = JSON.parse(txt);
      if (!J || !Array.isArray(J.ordenes)) throw new Error(fl.name + ' no es un archivo de Productividad');
      const O = (J.ordenes as Orden[]);
      aviso('ok', 'Subiendo ' + O.length.toLocaleString('es') + ' órdenes de ' + fl.name + '…', 120000);
      await base.agregarSiFaltan(O.map(filaDeOrden));
      O.forEach((o) => { const c = P.db.get(o[0]); if (!c || (c[7] == null && o[7] != null)) P.db.set(o[0], o); });
      for (const x of (J.extra || []) as Persona[]) if (!P.extra.some((e) => clave(e[1]) === clave(x[1])) && !P.idx.has(clave(x[1]))) { await base.agregarPersona(x); P.extra.push(x); }
      n += O.length;
    }
    P.reconstruir(); render();
    aviso('ok', 'Historial subido: ' + n.toLocaleString('es') + ' órdenes revisadas (solo se agregaron las que faltaban).', 30000);
  } catch (e) { aviso('err', 'No se pudo importar: ' + ((e as Error)?.message || 'error'), 30000); }
}

/* ---------------- Descargar HTML (copia de 45 días) ---------------- */
let propia: string | null = null;
async function gzB64(txt: string) {
  const buf = new Uint8Array(await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000))); return btoa(s);
}
async function plantilla(): Promise<string> {
  if (COPIA) { if (!propia) throw new Error('no se encontró la plantilla'); return propia; }
  const leer = async (u: string) => { try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.text() : null; } catch { return null; } };
  const tpl = await leer('./plantilla.html'), css = await leer('../nube/tema.css'), js = await leer('../nube/tema.js');
  if (!tpl || !css || !js) throw new Error('no se encontró la plantilla');
  return tpl.replace(/<link[^>]*href="\.\.\/nube\/tema\.css"[^>]*>/, () => '<style id="tema-css">' + css + '</style>')
    .replace(/<script[^>]*src="\.\.\/nube\/tema\.js"[^>]*><\/script>/, () => '<script>' + js.replace(/<\/script/gi, '<\\/script') + '</' + 'script>');
}
async function descargarHtml(btn: HTMLButtonElement) {
  const t0 = btn.textContent; btn.disabled = true; btn.textContent = 'Preparando…';
  try {
    const ds = P.dias(); if (!ds.length) throw new Error('todavía no hay datos');
    const desde = addD(ds[ds.length - 1], -44);
    const O = [...P.db.values()].filter((o) => o[5] >= desde).sort((a, b) => a[0] - b[0]);
    const b64 = await gzB64(JSON.stringify({ guardado: new Date().toISOString(), extra: P.extra, ordenes: O }));
    const tpl = await plantilla(), TAG = '<script type="text/plain" id="emb">', FIN = '</' + 'script>', emb = TAG + b64 + FIN;
    let html: string | null = null; const i = tpl.lastIndexOf(TAG);
    if (i >= 0) { const j = tpl.indexOf(FIN, i + TAG.length); if (j > 0 && /^[A-Za-z0-9+/=\s]*$/.test(tpl.slice(i + TAG.length, j))) html = tpl.slice(0, i) + emb + tpl.slice(j + FIN.length); }
    if (html == null) { const k = tpl.toLowerCase().lastIndexOf('</body>'); html = tpl.slice(0, k) + emb + tpl.slice(k); }
    const n = new Date(), hoy = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    descargar(new Blob([html], { type: 'text/html' }), 'Productividad_' + hoy + '.html');
    aviso('ok', 'Descargando el HTML de los últimos 45 días…');
  } catch (e) { aviso('err', 'No se pudo preparar el HTML: ' + ((e as Error)?.message || 'error'), 15000); }
  finally { btn.disabled = false; btn.textContent = t0; }
}

/* ---------------- arranque ---------------- */
function montar(ordenes: Orden[], extra: Persona[], usuario: string) {
  P = new Productividad(ordenes, extra);
  $('usuario').textContent = usuario; $('nbUser').textContent = usuario;
  conectar();
  const archivo = (btn: string, inp: string, fn: (f: File[]) => void) => {
    const i = $(inp) as HTMLInputElement;
    $(btn).addEventListener('click', () => i.click());
    i.addEventListener('change', () => { const fs = Array.from(i.files || []); i.value = ''; if (fs.length) fn(fs); });
  };
  archivo('selectBtn', 'fileInput', cargarExcel);
  archivo('importBtn', 'jsonInput', importarJson);
  $('shareBtn').addEventListener('click', () => descargarHtml($('shareBtn') as HTMLButtonElement));
  document.getElementById('acceso')?.remove();
  ponerSeccion((location.hash || '').slice(1) as Seccion);
  render();
}

async function leerB64(b64: string) {
  const bin = atob(b64.trim()), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return JSON.parse(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}

async function arrancar() {
  if (COPIA) {
    propia = '<!doctype html>\n' + document.documentElement.outerHTML;
    const el = document.getElementById('emb'), J = el && el.textContent && el.textContent.trim() ? await leerB64(el.textContent) : { ordenes: [], extra: [] };
    ($('importBtn') as HTMLElement).hidden = true; ($('todoBtn') as HTMLElement).hidden = true;
    montar(J.ordenes || [], J.extra || [], '');
    const ds = P.dias(); if (ds.length) $('modo').textContent = 'Últimos 45 días (' + fd(ds[0]) + ' – ' + fd(ds[ds.length - 1]) + ')';
    return;
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('prueba')) {
    const r = await fetch(import.meta.env.BASE_URL + 'tests/fixtures/productividad.local.json.gz');
    const buf = new Uint8Array(await r.arrayBuffer());
    const txt = buf[0] === 0x1f && buf[1] === 0x8b ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(buf);
    const J = JSON.parse(txt);
    montar(J.ordenes, J.extra || [], 'prueba');
    ($('todoBtn') as HTMLElement).hidden = true;
    return;
  }
  const [{ crearCliente, iniciarSesion, cargando, pantalla }, { BaseProductividad }] = await Promise.all([import('../app/sesion'), import('../nube/productividad')]);
  const sb = crearCliente();
  await iniciarSesion(sb, async (s) => {
    base = new BaseProductividad(sb);
    const todo = !!new URLSearchParams(location.search).get('todo');
    const d = new Date(); d.setDate(d.getDate() - 90);
    const desde = todo ? null : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let ordenes: Orden[], extra: Persona[];
    try { [ordenes, extra] = await Promise.all([base.leerOrdenes(desde, (p) => cargando('Órdenes… ' + p + '%')), base.leerPersonal()]); }
    catch (e) {
      const m = (e as Error)?.message || '';
      pantalla('<h1>Falta preparar la base</h1><p>' + (/does not exist|relation|schema cache/i.test(m) ? 'Todavía no existen las tablas de Productividad. Corre una vez <b>supabase/03_productividad.sql</b> en el SQL Editor de Supabase y vuelve a abrir la página.' : 'No se pudieron leer los datos: ' + esc(m)) + '</p>');
      return;
    }
    montar(ordenes, extra, s.user?.email || '');
    $('salir').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    const tb = $('todoBtn') as HTMLButtonElement;
    if (todo) tb.hidden = true;
    else tb.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('todo', '1'); location.href = u.toString(); });
  });
}

arrancar().catch((e) => { console.error(e); aviso('err', 'No se pudo abrir: ' + ((e as Error)?.message || 'error'), 30000); });
