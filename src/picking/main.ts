/**
 * Picking: historial del Rpt_OrdenesPreparacion por día, código y ubicación, y clasificación ABC por frecuencia.
 * No toca el Radar: tiene sus propias tablas (picking_dia, picking_codigos).
 */
import * as XLSX from 'xlsx';
import '../app/radar.css';
import '../app/estilos.css';
import '../productividad/prod.css';
import './picking.css';
import { leerExcelNegados } from '../core/negados/parseo';
import { resumirRpt, abc, type Codigo, type FilaAbc, type ResumenCodigo } from '../core/picking/resumen';
import { aviso, descargar } from '../app/ui/avisos';
import type { BasePicking } from '../nube/picking';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const p1 = (v: number) => (isFinite(v) ? v.toFixed(1) : '0.0') + '%';
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DI = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const fd = (d: string) => (+d.slice(8)) + '-' + MES[+d.slice(5, 7) - 1];
const fdl = (d: string) => (+d.slice(8)) + ' ' + MES[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4);
const addD = (d: string, n: number) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

let base: BasePicking | null = null;
let dias: { dia: string; lineas: number; codigos: number }[] = [];
let cat = new Map<string, Codigo>();
let filas: FilaAbc[] = [];
let rango = { desde: '', hasta: '' };
const S = { clase: '', q: '', sk: 'lineas', asc: false, max: 300 };

/* ---------------- días cargados ---------------- */
function renderDias() {
  const tot = dias.reduce((s, d) => s + d.lineas, 0);
  $('diasTitle').textContent = dias.length ? n0(dias.length) + ' días guardados, del ' + fdl(dias[0].dia) + ' al ' + fdl(dias[dias.length - 1].dia) + ' · ' + n0(tot) + ' líneas' : 'Todavía no hay días guardados';
  const M = new Map<string, typeof dias>();
  dias.forEach((d) => { const m = d.dia.slice(0, 7); (M.get(m) || M.set(m, []).get(m)!).push(d); });
  const max = Math.max(1, ...dias.map((d) => d.lineas));
  $('meses').innerHTML = [...M].reverse().map(([m, L]) => {
    const y = +m.slice(0, 4), mo = +m.slice(5, 7), nd = new Date(y, mo, 0).getDate(), por = new Map(L.map((d) => [d.dia, d]));
    let celdas = '';
    for (let i = 1; i <= nd; i++) {
      const d = m + '-' + String(i).padStart(2, '0'), x = por.get(d), w = new Date(d + 'T12:00:00').getDay();
      celdas += '<div class="pk-d' + (x ? '' : ' no') + (w === 0 ? ' dom' : '') + '" title="' + DI[w] + ' ' + fd(d) + (x ? ': ' + n0(x.lineas) + ' líneas, ' + n0(x.codigos) + ' códigos' : ': sin datos') + '"><span>' + i + '</span><i style="height:' + (x ? Math.max(4, x.lineas / max * 28) : 0) + 'px"></i></div>';
    }
    return '<div class="chart full pk-mes"><div class="cardhead"><div><h3>' + MESL[mo - 1] + ' ' + y + '</h3><p class="cardsub">' + L.length + ' de ' + nd + ' días · ' + n0(L.reduce((s, d) => s + d.lineas, 0)) + ' líneas</p></div></div><div class="pk-cal">' + celdas + '</div></div>';
  }).join('') || '<p class="pv-note">Carga el Rpt_OrdenesPreparacion de cada mes con el botón “Cargar Rpt”.</p>';
}

/* ---------------- rango ---------------- */
function llenarRango() {
  const ds = dias.map((d) => d.dia);
  for (const id of ['d1', 'd2']) { const e = $(id) as HTMLSelectElement, cur = e.value; e.innerHTML = ds.map((d) => `<option value="${d}">${DI[new Date(d + 'T12:00:00').getDay()]} ${fdl(d)}</option>`).join(''); e.value = cur; }
  if (!rango.desde && ds.length) rango = { desde: ds[0], hasta: ds[ds.length - 1] };
  ($('d1') as HTMLSelectElement).value = rango.desde; ($('d2') as HTMLSelectElement).value = rango.hasta;
  const ult = ds[ds.length - 1];
  document.querySelectorAll<HTMLElement>('#pkPer button').forEach((b) => { const m = b.dataset.m!; b.classList.toggle('active', !!ult && rango.hasta === ult && (m === 'all' ? rango.desde === ds[0] : rango.desde === desdePara(+m))); });
}
const desdePara = (n: number) => { const ds = dias.map((d) => d.dia), f = addD(ds[ds.length - 1], -(n - 1)); return ds.find((d) => d >= f) || ds[0]; };

async function verRango(desde: string, hasta: string) {
  if (!base || !desde || !hasta) return;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  rango = { desde, hasta }; llenarRango();
  $('abcTitle').textContent = 'Calculando…';
  try {
    const res: ResumenCodigo[] = await base.resumen(desde, hasta, (n) => { $('abcTitle').textContent = 'Calculando… ' + n0(n) + ' códigos'; });
    filas = abc(res, cat);
    render();
  } catch (e) { aviso('err', 'No se pudo calcular: ' + ((e as Error)?.message || 'error'), 20000); }
}

/* ---------------- ABC ---------------- */
function render() {
  const nd = dias.filter((d) => d.dia >= rango.desde && d.dia <= rango.hasta).length;
  $('rangoTxt').textContent = nd ? n0(nd) + ' días con datos' : '';
  document.body.classList.toggle('nodata', !filas.length);
  const T = filas.reduce((s, f) => ({ l: s.l + f.lineas, u: s.u + f.unidades, n: s.n + f.neg_proceso + f.neg_sinstock + f.neg_negativo, e: s.e + f.neg_proceso }), { l: 0, u: 0, n: 0, e: 0 });
  const cls = (['A', 'B', 'C'] as const).map((c) => { const L = filas.filter((f) => f.clase === c); return { c, n: L.length, l: L.reduce((s, f) => s + f.lineas, 0), u: L.reduce((s, f) => s + f.unidades, 0), e: L.reduce((s, f) => s + f.neg_proceso, 0) }; });
  if (!filas.length) { $('abcTitle').textContent = dias.length ? 'Sin líneas en el rango elegido' : 'Todavía no hay datos de picking'; $('abcLead').textContent = dias.length ? '' : 'Carga el Rpt_OrdenesPreparacion de cada mes con el botón “Cargar Rpt”. Cada mes se guarda una sola vez aunque lo cargues de nuevo.'; $('kp').innerHTML = ''; $('clases').innerHTML = ''; $('tb').innerHTML = ''; $('th').innerHTML = ''; return; }
  const A = cls[0];
  $('abcTitle').textContent = n0(A.n) + ' códigos (' + p1(A.n / filas.length * 100) + ') concentran el ' + p1(A.l / T.l * 100) + ' del picking';
  $('abcLead').textContent = 'Del ' + fdl(rango.desde) + ' al ' + fdl(rango.hasta) + ': ' + n0(T.l) + ' líneas pedidas de ' + n0(filas.length) + ' códigos distintos. Esos códigos clase A son los primeros candidatos a las ubicaciones más cercanas a despacho y a la altura más cómoda.';
  const kpi = (l: string, v: string, f: string) => '<div class="kpi"><div class="lbl">' + l + '</div><div class="val tabular">' + v + '</div><div class="foot">' + f + '</div></div>';
  $('kp').innerHTML = kpi('Líneas pedidas', n0(T.l), n0(nd) + ' días · ' + n0(T.l / Math.max(1, nd)) + ' por día') + kpi('Códigos', n0(filas.length), n0(A.n) + ' clase A · ' + n0(cls[1].n) + ' B · ' + n0(cls[2].n) + ' C') +
    kpi('Unidades pedidas', n0(T.u), 'suma de Cantidad') + kpi('Negadas por error en el proceso', n0(T.e), p1(T.e / T.l * 100) + ' de las líneas · había stock en sistema');
  $('clases').innerHTML = cls.map((x) => `<tr><td class="l"><b class="pk-c ${x.c}">${x.c}</b></td><td>${n0(x.n)}</td><td>${p1(x.n / filas.length * 100)}</td><td>${n0(x.l)}</td><td>${p1(x.l / T.l * 100)}</td><td>${n0(x.u)}</td><td>${n0(x.e)}</td></tr>`).join('');
  tabla();
}
type Col = [keyof FilaAbc | 'neg', string, string, string?];
const COLS: Col[] = [['clase', 'Clase', 'l'], ['sku', 'Código', 'l'], ['descripcion', 'Descripción', 'l'], ['um', 'UM', 'l'], ['ubicacion', 'Ubicación principal', 'l'], ['ubicaciones', 'Ubic.', '', 'Ubicaciones distintas en las que se preparó'], ['lineas', 'Líneas', ''], ['acumulado', '% acum.', '', 'Porcentaje acumulado de las líneas'], ['dias', 'Días', '', 'Días con al menos un pedido'], ['unidades', 'Unidades', ''], ['pedidos', 'Pedidos', ''], ['neg', 'Negadas', '', 'Líneas negadas (cualquier motivo)'], ['neg_proceso', 'Error proceso', '', 'Negadas con stock en sistema']];
function tabla() {
  const q = S.q.trim().toLowerCase();
  let L = filas.filter((f) => (!S.clase || f.clase === S.clase) && (!q || f.sku.toLowerCase().includes(q) || f.descripcion.toLowerCase().includes(q) || f.ubicacion.toLowerCase().includes(q)));
  const val = (f: FilaAbc) => (S.sk === 'neg' ? f.neg_proceso + f.neg_sinstock + f.neg_negativo : (f as unknown as Record<string, number | string>)[S.sk]);
  L = L.slice().sort((a, b) => { const x = val(a), y = val(b); const d = typeof x === 'string' ? String(x).localeCompare(String(y), 'es', { numeric: true }) : (x as number) - (y as number); return S.asc ? d : -d; });
  $('th').innerHTML = COLS.map((c) => `<th class="${c[2]}" data-k="${c[0]}"${c[3] ? ` title="${c[3]}"` : ''}>${c[1]}${S.sk === c[0] ? (S.asc ? ' ▲' : ' ▼') : ''}</th>`).join('');
  $('tb').innerHTML = L.slice(0, S.max).map((f) => `<tr><td class="l"><b class="pk-c ${f.clase}">${f.clase}</b></td><td class="l">${esc(f.sku)}</td><td class="l nm" title="${esc(f.descripcion)}">${esc(f.descripcion)}</td><td class="l dim">${esc(f.um)}</td><td class="l">${esc(f.ubicacion) || '<span class="dim">—</span>'}</td><td class="${f.ubicaciones > 1 ? 'pk-w' : 'dim'}">${f.ubicaciones}</td><td><b>${n0(f.lineas)}</b></td><td class="dim">${p1(f.acumulado)}</td><td>${f.dias}</td><td>${n0(f.unidades)}</td><td>${n0(f.pedidos)}</td><td>${n0(f.neg_proceso + f.neg_sinstock + f.neg_negativo)}</td><td class="${f.neg_proceso ? 'pk-w' : 'dim'}">${n0(f.neg_proceso)}</td></tr>`).join('') || `<tr><td colspan="${COLS.length}" class="empty">No hay códigos con ese filtro.</td></tr>`;
  $('tablaSub').textContent = n0(L.length) + ' códigos' + (L.length > S.max ? ' · se muestran los primeros ' + S.max + ' (el Excel trae todos)' : '');
  $('tablaNota').textContent = 'Líneas = veces que se pidió el código (una por pedido, sin duplicados de reasignación). Ubicación principal = la ubicación 1 en la que más se pidió; “Ubic.” en naranja = se preparó desde más de una ubicación en el rango. Clic en un encabezado para ordenar.';
}
function excel() {
  if (!filas.length) { aviso('err', 'No hay datos en el rango.'); return; }
  const head = ['Clase', 'Código', 'Descripción', 'UM', 'Categoría', 'Ubicación principal', 'Ubicaciones distintas', 'Líneas', '% acumulado', 'Días con pedido', 'Unidades pedidas', 'Pedidos', 'Líneas preparadas', 'Unidades preparadas', 'Negadas error en el proceso', 'Negadas sin existencia', 'Negadas inventario negativo'];
  const ws = XLSX.utils.aoa_to_sheet([head, ...filas.map((f) => [f.clase, f.sku, f.descripcion, f.um, f.categoria, f.ubicacion, f.ubicaciones, f.lineas, +f.acumulado.toFixed(2), f.dias, f.unidades, f.pedidos, f.lineas_prep, f.unid_prep, f.neg_proceso, f.neg_sinstock, f.neg_negativo])]);
  ws['!cols'] = [6, 10, 50, 6, 10, 16, 10, 9, 11, 10, 10, 9, 10, 11, 12, 12, 12].map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: head.length - 1 } }) };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'ABC por frecuencia');
  descargar(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Picking_ABC_' + rango.desde + '_a_' + rango.hasta + '.xlsx');
}

/* ---------------- cargar Rpt ---------------- */
let ocupado = false;
async function cargar(files: File[]) {
  if (ocupado || !base) return; ocupado = true;
  const btn = $('selectBtn') as HTMLButtonElement, t0 = btn.textContent;
  btn.disabled = true;
  const hechos: string[] = [];
  try {
    for (const f of files) {
      btn.textContent = 'Leyendo ' + f.name + '…';
      let R;
      try { R = resumirRpt(leerExcelNegados(new Uint8Array(await f.arrayBuffer()))); }
      catch (e) { aviso('err', f.name + ': ' + ((e as Error)?.message || 'no se pudo leer'), 20000); continue; }
      if (!R.filas.length) { hechos.push(f.name + ': sin líneas'); continue; }
      btn.textContent = 'Guardando ' + f.name + '…';
      const G = await base.reemplazarDias(R.dias, R.filas, R.corte, f.name, (p) => { btn.textContent = 'Guardando ' + f.name + '… ' + p + '%'; });
      await base.guardarCodigos(R.codigos);
      await base.registrarCarga({ archivo: f.name, dias: G.guardados, omitidos: G.omitidos, lineas: R.lineas });
      R.codigos.forEach((c) => cat.set(c.sku, c));
      hechos.push(f.name + ': ' + (G.guardados.length ? G.guardados.length + ' días guardados (' + fd(G.guardados[0]) + ' a ' + fd(G.guardados[G.guardados.length - 1]) + ')' : 'ningún día guardado') +
        (G.omitidos.length ? '; ' + G.omitidos.length + ' día(s) se dejaron como estaban porque ya tenían un archivo más nuevo (' + G.omitidos.map(fd).join(', ') + ')' : ''));
    }
    dias = await base.cobertura();
    renderDias();
    const ds = dias.map((d) => d.dia);
    if (ds.length) await verRango(rango.desde && ds.includes(rango.desde) ? rango.desde : ds[0], ds[ds.length - 1]);
    if (hechos.length) aviso('ok', 'Guardado. ' + hechos.join(' · '), 30000);
  } catch (e) {
    aviso('err', 'No se pudo guardar: ' + ((e as Error)?.message || 'error') + '. Vuelve a cargar ese archivo; los días se reemplazan, no se duplican.', 40000);
  } finally { ocupado = false; btn.disabled = false; btn.textContent = t0; }
}

/* ---------------- arranque ---------------- */
function conectar() {
  document.querySelectorAll<HTMLAnchorElement>('#vxNav a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); const t = a.dataset.tab!;
    document.querySelectorAll<HTMLAnchorElement>('#vxNav a').forEach((x) => x.classList.toggle('on', x === a));
    $('tab-abc').hidden = t !== 'abc'; $('tab-dias').hidden = t !== 'dias';
  }));
  const i = $('fileInput') as HTMLInputElement;
  $('selectBtn').addEventListener('click', () => i.click());
  i.addEventListener('change', () => { const fs = Array.from(i.files || []); i.value = ''; if (fs.length) cargar(fs); });
  $('xlsBtn').addEventListener('click', excel);
  $('verBtn').addEventListener('click', () => verRango(($('d1') as HTMLSelectElement).value, ($('d2') as HTMLSelectElement).value));
  $('pkPer').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b || !dias.length) return;
    const ds = dias.map((d) => d.dia); verRango(b.dataset.m === 'all' ? ds[0] : desdePara(+b.dataset.m!), ds[ds.length - 1]);
  });
  $('claseF').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
    S.clase = b.dataset.c || ''; $('claseF').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); tabla();
  });
  $('buscar').addEventListener('input', (e) => { S.q = (e.target as HTMLInputElement).value; tabla(); });
  $('th').addEventListener('click', (e) => {
    const th = (e.target as HTMLElement).closest<HTMLElement>('th'); if (!th) return;
    const k = th.dataset.k!; S.asc = S.sk === k ? !S.asc : ['sku', 'descripcion', 'um', 'ubicacion', 'clase'].includes(k); S.sk = k; tabla();
  });
}

/** Solo en desarrollo (?prueba=1): una base en memoria que suma igual que las funciones de Supabase. */
function baseDePrueba(): BasePicking {
  const D = new Map<string, import('../core/picking/resumen').FilaPicking>(), C = new Map<string, Codigo>(), K = new Map<string, number>();
  return {
    async reemplazarDias(ds: string[], fs: import('../core/picking/resumen').FilaPicking[], corte: number) {
      const guardados = ds.filter((d) => !K.has(d) || corte >= K.get(d)!), omitidos = ds.filter((d) => !guardados.includes(d)), set = new Set(guardados);
      for (const [k, f] of D) if (set.has(f.dia)) D.delete(k);
      fs.forEach((f) => { if (set.has(f.dia)) D.set(f.dia + '|' + f.sku + '|' + f.ubicacion, f); }); guardados.forEach((d) => K.set(d, corte));
      return { guardados, omitidos };
    },
    async guardarCodigos(c: Codigo[]) { c.forEach((x) => C.set(x.sku, x)); },
    async cobertura() { const M = new Map<string, { dia: string; lineas: number; s: Set<string> }>(); D.forEach((f) => { const x = M.get(f.dia) || M.set(f.dia, { dia: f.dia, lineas: 0, s: new Set() }).get(f.dia)!; x.lineas += f.lineas; x.s.add(f.sku); }); return [...M.values()].sort((a, b) => (a.dia < b.dia ? -1 : 1)).map((x) => ({ dia: x.dia, lineas: x.lineas, codigos: x.s.size })); },
    async resumen(desde: string, hasta: string) {
      const M = new Map<string, ResumenCodigo & { _u: Map<string, number>; _d: Set<string> }>();
      D.forEach((f) => { if (f.dia < desde || f.dia > hasta) return; let x = M.get(f.sku); if (!x) M.set(f.sku, (x = { sku: f.sku, ubicacion: '', ubicaciones: 0, lineas: 0, unidades: 0, lineas_prep: 0, unid_prep: 0, neg_proceso: 0, neg_sinstock: 0, neg_negativo: 0, dias: 0, pedidos: 0, _u: new Map(), _d: new Set() }));
        x.lineas += f.lineas; x.unidades += f.unidades; x.lineas_prep += f.lineas_prep; x.unid_prep += f.unid_prep; x.neg_proceso += f.neg_proceso; x.neg_sinstock += f.neg_sinstock; x.neg_negativo += f.neg_negativo; x.pedidos += f.pedidos; x._d.add(f.dia); x._u.set(f.ubicacion, (x._u.get(f.ubicacion) || 0) + f.lineas); });
      // igual que la función de la base: la ubicación con más líneas (sin la vacía; en empate, la primera en orden)
      return [...M.values()].map(({ _u, _d, ...x }) => ({ ...x, dias: _d.size, ubicaciones: [..._u.keys()].filter((u) => u).length, ubicacion: [..._u].sort((a, b) => Number(a[0] === '') - Number(b[0] === '') || b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] }));
    },
    async codigos() { return [...C.values()]; },
    async registrarCarga() { /* nada */ },
  } as unknown as BasePicking;
}

async function arrancar() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('prueba')) {
    base = baseDePrueba(); $('nbUser').textContent = 'prueba'; conectar(); renderDias(); llenarRango(); render(); return;
  }
  const [{ crearCliente, iniciarSesion, cargando, pantalla }, { BasePicking }] = await Promise.all([import('../app/sesion'), import('../nube/picking')]);
  const sb = crearCliente();
  await iniciarSesion(sb, async (s) => {
    base = new BasePicking(sb);
    try {
      cargando('Días guardados…');
      const [cob, cods] = await Promise.all([base.cobertura(), base.codigos()]);
      dias = cob; cat = new Map(cods.map((c) => [c.sku, c]));
    } catch (e) {
      const m = (e as Error)?.message || '';
      pantalla('<h1>Falta preparar la base</h1><p>' + (/does not exist|relation|schema cache|function/i.test(m) ? 'Todavía no existen las tablas de picking. Corre una vez <b>supabase/04_picking.sql</b> en el SQL Editor de Supabase y vuelve a abrir la página.' : 'No se pudieron leer los datos: ' + esc(m)) + '</p>');
      return;
    }
    document.getElementById('acceso')?.remove();
    $('usuario').textContent = s.user?.email || ''; $('nbUser').textContent = s.user?.email || '';
    $('salir').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    $('sub').textContent = dias.length ? n0(dias.length) + ' días guardados · ' + fdl(dias[0].dia) + ' al ' + fdl(dias[dias.length - 1].dia) : 'Sin datos todavía';
    conectar(); renderDias(); llenarRango();
    if (dias.length) await verRango(rango.desde, rango.hasta); else render();
  });
}
arrancar().catch((e) => { console.error(e); aviso('err', 'No se pudo abrir: ' + ((e as Error)?.message || 'error'), 30000); });
