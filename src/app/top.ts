/**
 * Pestaña "Top negados": ranking por veces, ranking por unidades, motivo,
 * sucursales y detalle de códigos. Misma apariencia y reglas que el Radar original.
 */
import * as XLSX from 'xlsx';
import type { RadarNegados, VistaAgregada } from '../core/negados/radar';
import { BUCKETS, type Bucket, type DiaResumen } from '../core/negados/tipos';
import { $, esc, fmtInt, fmtDateShort, fechaLarga, normText } from './ui/formato';
import { aviso, descargar } from './ui/avisos';
import { sinActualizarPorCodigo } from '../core/negados/extras';
import { ymd } from '../core/comun/fechas';

const BUCKET_LABEL: Record<Bucket, string> = { positivo: 'Error en el proceso', cero: 'Sin existencia', negativo: 'Inventario negativo' };
type ClaveDetalle = 'sku' | 'desc' | 'bucket' | 'count';
type Grupo = 'uni' | 'pqt' | 'm' | 'otr' | '';

const umGrupo = (um: string): Grupo => {
  const u = String(um || '').trim();
  if (/^uni/i.test(u)) return 'uni';
  if (/^pqt/i.test(u)) return 'pqt';
  if (/^([\d.]+\s*)?m$/i.test(u) || /^cm$/i.test(u)) return 'm';
  return u ? 'otr' : '';
};
const umFactor = (um: string): number => {
  const u = String(um || '').trim(), m = u.match(/^([\d.]+)\s*m$/i);
  if (m) return +m[1];
  if (/^cm$/i.test(u)) return 0.01;
  return 1;
};
const qtyFmt = (v: number, g: Grupo) => g === 'm' ? (v >= 100 ? fmtInt(v) : v.toFixed(1).replace('.', ',')) + ' m' : fmtInt(v) + (g === 'uni' ? ' uni' : g === 'pqt' ? ' PQT' : '');
const promTxt = (a: number, unit?: string) => 'prom. ' + (a >= 10 ? fmtInt(a) : a.toFixed(1).replace('.', ',')) + (unit ? ' ' + unit : '') + '/día';

/** Minigráfico con línea de promedio (sin contar días parciales). */
function sparkProm(vals: (number | null)[], part: Set<number>, col: string) {
  const W = 120, H = 26, n = vals.length;
  if (n < 2) return null;
  const xs = vals.map((v) => v || 0), max = Math.max(1, ...xs);
  const x = (i: number) => i * (W - 2) / (n - 1) + 1, y = (v: number) => H - 2 - (v / max) * (H - 5);
  const pts = vals.map((v, i) => (v == null ? null : x(i).toFixed(1) + ',' + y(v).toFixed(1))).filter(Boolean).join(' ');
  const av = vals.filter((v, i) => v != null && !part.has(i)) as number[];
  const avg = av.length ? av.reduce((a, b) => a + b, 0) / av.length : 0;
  return {
    svg: '<svg class="spk" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><line x1="1" x2="' + (W - 1) + '" y1="' + y(avg).toFixed(1) + '" y2="' + y(avg).toFixed(1) +
      '" stroke="#26241F" stroke-width="1.2" stroke-dasharray="3 2"/><polyline fill="none" stroke="' + col + '" stroke-width="1.4" points="' + pts + '"/></svg>',
    avg,
  };
}

export class TopNegados {
  vm: VistaAgregada | null = null;
  codigoSel: string | null = null;
  buckets = new Set<Bucket>();
  busqueda = '';
  orden: { key: ClaveDetalle; dir: 'asc' | 'desc' } = { key: 'count', dir: 'desc' };
  /** Al hacer clic en un día de un gráfico. */
  alElegirDia: ((d: string) => void) | null = null;

  constructor(private radar: RadarNegados) { this.conectar(); }

  private um(sku: string): string { const s = this.radar.store.skus[sku]; return (s && s[2]) || ''; }
  private dia(d: string): DiaResumen | null { const r = this.radar.history[d] as DiaResumen | undefined; return r && r.v === 2 ? r : null; }
  private diasSel(vm: VistaAgregada): string[] { return vm.meta.fecha ? [vm.meta.fecha] : this.radar.diasEnRango(vm.rangeFrom, vm.rangeTo); }

  private conectar() {
    $('searchInput').addEventListener('input', (e) => { this.busqueda = (e.target as HTMLInputElement).value; this.renderDetalle(); });
    $('bucketFilter').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button'); if (!btn) return;
      const b = btn.getAttribute('data-bucket') as Bucket | 'all', F = this.buckets;
      if (b === 'all') F.clear(); else { if (F.has(b)) F.delete(b); else F.add(b); if (F.size === BUCKETS.length) F.clear(); }
      $('bucketFilter').querySelectorAll('button').forEach((x) => { const k = x.getAttribute('data-bucket') as Bucket | 'all'; x.classList.toggle('active', k === 'all' ? !F.size : F.has(k)); });
      this.renderDetalle();
    });
    document.querySelectorAll<HTMLElement>('#detailTable thead th').forEach((th) => th.addEventListener('click', () => {
      const key = th.dataset.key as ClaveDetalle;
      if (this.orden.key === key) this.orden.dir = this.orden.dir === 'asc' ? 'desc' : 'asc';
      else this.orden = { key, dir: key === 'count' ? 'desc' : 'asc' };
      this.renderDetalle();
    }));
    $('downloadTopCodesBtn').addEventListener('click', () => this.excelTop());
    $('detailDlBtn').addEventListener('click', () => this.excelDetalle());
    document.getElementById('pnegDl')?.addEventListener('click', () => this.excelSinActualizar());
  }

  /** Ventana de días para las tendencias (hasta 30 días). */
  private ventana(vm: VistaAgregada) {
    const all = this.radar.dias();
    let days: string[];
    if (vm.meta.fecha) { const f = vm.meta.fecha; days = all.filter((d) => d <= f).slice(-30); }
    else {
      days = all.filter((d) => d >= vm.rangeFrom && d <= vm.rangeTo);
      if (days.length < 7) { const end = vm.rangeTo || all[all.length - 1]; days = all.filter((d) => d <= end).slice(-30); }
    }
    const part = new Set<number>();
    days.forEach((d, i) => { if (this.radar.isPartialDay(d)) part.add(i); });
    return { days, part };
  }
  private vecesPorDia(sku: string, days: string[]) {
    return days.map((d) => {
      const r = this.dia(d);
      if (r) { const c = r.codes[sku]; return c ? c[0] + c[1] + c[2] : 0; }
      return (this.radar.vistaDia(d).codes || []).filter((c) => c.sku === sku).reduce((a, c) => a + c.count, 0);
    });
  }
  private cantidadPorDia(sku: string, days: string[]) {
    const f = umFactor(this.um(sku));
    return days.map((d) => { const q = this.dia(d)?.qty; return q ? (q[sku] || 0) * f : null; });
  }
  private cantidades(vm: VistaAgregada) {
    const out: Record<string, number> = {}, ds = this.diasSel(vm);
    let has = 0;
    ds.forEach((d) => { const q = this.dia(d)?.qty; if (!q) return; has++; for (const s in q) out[s] = (out[s] || 0) + q[s]; });
    return { qty: out, has, n: ds.length };
  }

  render(vm: VistaAgregada) {
    this.vm = vm;
    if (!this.codigoSel && vm.topCodes.length) this.codigoSel = vm.topCodes[0].sku;
    const m = vm.meta, p = m.fecha ? 'el ' + fechaLarga(m.fecha) + (this.radar.isPartialDay(m.fecha) ? ' (corte parcial)' : '') : 'del ' + fechaLarga(vm.rangeFrom) + ' al ' + fechaLarga(vm.rangeTo);
    const tn = m.totalNegados || 0, top = vm.topCodes.slice(0, 10), s10 = top.reduce((a, c) => a + c.count, 0), p10 = tn ? Math.round(s10 / tn * 100) : 0;
    if (!m.totalFinal) { $('tpTitle').textContent = 'Sin negados ' + p; $('tpLead').textContent = ''; }
    else {
      $('tpTitle').textContent = 'Los 10 códigos más negados suman el ' + p10 + '% de los negados ' + p;
      $('tpLead').innerHTML = '<b>' + fmtInt(s10) + '</b> de ' + fmtInt(tn) + ' líneas negadas. ' + (top.length ? 'El primero, <b>' + esc(top[0].sku) + '</b>, se negó ' + fmtInt(top[0].count) + ' veces. ' : '');
    }
    this.renderRanking1();
    this.renderRanking2();
    this.renderMotivo();
    this.renderSucursales();
    this.renderDetalle();
    this.renderSinActualizar();
  }

  private elegirCodigo(sku: string) { this.codigoSel = sku; this.renderRanking1(); this.renderDetalle(); }

  private renderRanking1() {
    const el = $('topBars'), vm = this.vm;
    const list = vm ? vm.topCodes.slice(0, 10) : [];
    if (!list.length || !vm) { el.innerHTML = '<p class="q">Sin datos</p>'; return; }
    const { days, part } = this.ventana(vm), Q = this.cantidades(vm), pos: Record<string, number> = {};
    vm.codes.forEach((c) => { if (c.bucket === 'positivo') pos[c.sku] = (pos[c.sku] || 0) + c.count; });
    let h = '<div class="tw"><table class="rk-tbl"><thead><tr><th>#</th><th>Código</th><th>Descripción</th><th class="n">Veces</th><th class="n">Unidades</th><th class="n">Con existencia</th><th>Tendencia · ' + days.length + ' días</th></tr></thead><tbody>';
    list.forEach((d, i) => {
      const um = this.um(d.sku), g = umGrupo(um), q = Q.has ? (Q.qty[d.sku] || 0) * umFactor(um) : null, sp = sparkProm(this.vecesPorDia(d.sku, days), part, '#DE7A2C');
      h += '<tr class="clk' + (d.sku === this.codigoSel ? ' sel' : '') + '" data-sku="' + esc(d.sku) + '"><td class="n0">' + (i + 1) + '</td><td class="sku">' + esc(d.sku) + '</td><td>' + esc(d.desc) +
        '</td><td class="n"><b>' + fmtInt(d.count) + '</b></td><td class="n">' + (q == null ? '—' : qtyFmt(q, g === 'otr' ? '' : g) + (g === 'otr' ? ' ' + esc(um) : '')) +
        '</td><td class="n">' + Math.round((pos[d.sku] || 0) / d.count * 100) + '%</td><td class="trc">' + (sp ? sp.svg + '<span>' + promTxt(sp.avg) + '</span>' : '') + '</td></tr>';
    });
    el.innerHTML = h + '</tbody></table></div>';
    el.querySelectorAll<HTMLElement>('tr.clk').forEach((r) => r.addEventListener('click', () => this.elegirCodigo(r.dataset.sku!)));
  }

  private renderRanking2() {
    const box = $('vxR2'), note = $('vxR2Note'), vm = this.vm!;
    const Q = this.cantidades(vm), { days, part } = this.ventana(vm);
    const daysQ = days.filter((d) => this.dia(d)?.qty), partQ = new Set<number>();
    daysQ.forEach((d, i) => { if (this.radar.isPartialDay(d)) partQ.add(i); });
    if (!Q.has) { box.innerHTML = '<p class="q">Las unidades negadas se registran desde el 7 oct 2026 (días con el cálculo nuevo). Elige un día o rango desde esa fecha.</p>'; note.textContent = ''; return; }
    note.textContent = Q.has < Q.n ? 'Unidades de ' + Q.has + ' de los ' + Q.n + ' días elegidos (se registran desde el 7 oct 2026).' : '';
    const veces: Record<string, number> = {};
    vm.topCodes.forEach((c) => { veces[c.sku] = c.count; });
    const items = Object.keys(Q.qty).map((s) => { const um = this.um(s); return { sku: s, desc: (this.radar.store.skus[s] || [''])[0], um, g: umGrupo(um), q: Q.qty[s] * umFactor(um), v: veces[s] || 0 }; }).filter((i) => i.q > 0 || i.v > 0);
    type It = typeof items[number];
    const G: { g: Grupo; t: string; s: string; sort: (a: It, b: It) => number }[] = [
      { g: 'uni', t: 'Unidades', s: 'Top 5 por cantidad negada en unidades (uni).', sort: (a, b) => b.q - a.q },
      { g: 'pqt', t: 'Paquetes', s: 'Top 5 por cantidad negada en paquetes (PQT).', sort: (a, b) => b.q - a.q },
      { g: 'm', t: 'Metros', s: 'Top 5 por cantidad negada en metros (m); yardas y pies convertidos a metros.', sort: (a, b) => b.q - a.q },
      { g: 'otr', t: 'Otras unidades de medida', s: 'Rollos, juegos, cajas, pares y otras: ordenado por veces negado, porque sus cantidades no se pueden comparar entre sí.', sort: (a, b) => b.v - a.v || b.q - a.q },
    ];
    box.innerHTML = G.map((gr) => {
      const L = items.filter((i) => i.g === gr.g).sort(gr.sort).slice(0, 5);
      let h = '<div class="r2"><h4>' + gr.t + '</h4><p class="q">' + gr.s + '</p>';
      if (!L.length) return h + '<p class="q">Sin negados en esta unidad.</p></div>';
      const otr = gr.g === 'otr';
      h += '<div class="tw"><table class="rk-tbl"><thead><tr><th>Código</th><th>Descripción</th><th class="n">' + (otr ? 'Veces' : 'Cantidad') + '</th><th class="n">' + (otr ? 'Cantidad' : 'Veces') + '</th><th>' +
        (otr ? 'Tendencia · ' + days.length + ' días' : 'Tendencia · ' + daysQ.length + ' días con unidades') + '</th></tr></thead><tbody>';
      L.forEach((i) => {
        const sp = otr ? sparkProm(this.vecesPorDia(i.sku, days), part, '#3A76B0') : sparkProm(this.cantidadPorDia(i.sku, daysQ), partQ, '#3A76B0');
        const qtxt = otr ? fmtInt(i.q) + ' ' + esc(i.um) : qtyFmt(i.q, gr.g);
        h += '<tr class="clk" data-sku="' + esc(i.sku) + '"><td class="sku">' + esc(i.sku) + '</td><td>' + esc(i.desc) + '</td><td class="n"><b>' + (otr ? fmtInt(i.v) : qtxt) + '</b></td><td class="n">' +
          (otr ? qtxt : fmtInt(i.v)) + '</td><td class="trc">' + (sp ? sp.svg + '<span>' + promTxt(sp.avg, otr ? 'veces' : gr.g === 'm' ? 'm' : gr.g === 'pqt' ? 'PQT' : 'uni') + '</span>' : '') + '</td></tr>';
      });
      return h + '</tbody></table></div></div>';
    }).join('');
    box.querySelectorAll<HTMLElement>('tr.clk').forEach((r) => r.addEventListener('click', () => this.elegirCodigo(r.dataset.sku!)));
  }

  private renderMotivo() {
    const el = $('donutLegend'), c = this.vm!.bucketCounts;
    const G = [
      { l: 'Error en el proceso', d: 'había stock en sistema y no se encontró', v: c.positivo || 0, c: 'var(--orange)' },
      { l: 'Sin stock', d: 'disponible en 0 (' + fmtInt(c.cero || 0) + ') o negativo (' + fmtInt(c.negativo || 0) + ')', v: (c.cero || 0) + (c.negativo || 0), c: 'var(--blue)' },
    ];
    const total = G[0].v + G[1].v, max = Math.max(1, G[0].v, G[1].v);
    el.className = 'vx-bars';
    el.innerHTML = G.map((g) => '<div class="vb"><div class="vb-l"><b>' + g.l + '</b><span>' + g.d + '</span></div><div class="vb-t"><i style="width:' + Math.max(g.v ? 1 : 0, g.v / max * 100) + '%;background:' + g.c + '"></i></div><div class="vb-n">' + fmtInt(g.v) + '<span>' + (total ? Math.round(g.v / total * 100) : 0) + '%</span></div></div>').join('');
  }

  private renderSucursales() {
    const el = $('storeBars'), list = this.vm!.byStore.slice(0, 12);
    if (!list.length) { el.innerHTML = '<div class="empty-row"><td>Sin datos</td></div>'; return; }
    const max = Math.max(...list.map((d) => d.count), 1);
    el.innerHTML = list.map((d) => '<div class="barrow"><span class="code" style="font-family:var(--font-body);font-size:12px;">' + esc(d.name) + '</span><span class="track" title="' + esc(d.name) + ' — ' + d.count +
      ' negados"><span class="fill" style="width:' + Math.max(3, d.count / max * 100) + '%;background:var(--steel);"></span></span><span class="num tabular">' + d.count + '</span></div>').join('');
  }

  /** Filas del detalle con los motivos y la búsqueda elegidos. */
  filasDetalle() {
    let rows = this.vm?.codes || [];
    if (this.buckets.size) rows = rows.filter((r) => this.buckets.has(r.bucket));
    if (this.busqueda) { const q = normText(this.busqueda); rows = rows.filter((r) => normText(r.sku).includes(q) || normText(r.desc).includes(q)); }
    return rows;
  }

  private renderDetalle() {
    if (!this.vm) return;
    const { key, dir } = this.orden;
    const rows = this.filasDetalle().slice().sort((a, b) => {
      let av: string | number = a[key], bv: string | number = b[key];
      if (typeof av === 'string') { av = av.toLowerCase(); bv = String(bv).toLowerCase(); }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    const body = $('tableBody');
    body.innerHTML = rows.length ? rows.slice(0, 500).map((r) => '<tr class="' + (r.sku === this.codigoSel ? 'selected' : '') + '" data-sku="' + esc(r.sku) + '"><td class="code">' + esc(r.sku) + '</td><td class="desc">' + esc(r.desc) +
      '</td><td><span class="pill ' + r.bucket + '"><span class="dot"></span>' + BUCKET_LABEL[r.bucket] + '</span></td><td class="count tabular">' + r.count + '</td></tr>').join('')
      : '<tr class="empty-row"><td colspan="4">No hay resultados para este filtro.</td></tr>';
    body.querySelectorAll<HTMLElement>('tr[data-sku]').forEach((tr) => tr.addEventListener('click', () => this.elegirCodigo(tr.dataset.sku!)));
    $('tableCount').textContent = rows.length + ' código' + (rows.length === 1 ? '' : 's') + (rows.length > 500 ? ' (mostrando 500)' : '');
    document.querySelectorAll<HTMLElement>('#detailTable thead th').forEach((th) => {
      let a = th.querySelector('.arrow');
      if (key === th.dataset.key) {
        if (!a) { a = document.createElement('span'); a.className = 'arrow'; th.appendChild(a); }
        a.textContent = ' ' + (dir === 'asc' ? '▲' : '▼');
      } else a?.remove();
    });
  }

  /* ---------------- Excel ---------------- */
  private sufijo(vm: VistaAgregada) { return vm.date || (vm.rangeFrom ? vm.rangeFrom + '_a_' + vm.rangeTo : 'sin_fecha'); }
  private fechaTxt(vm: VistaAgregada) {
    return vm.date ? 'Día: ' + fmtDateShort(vm.date) + (this.radar.isPartialDay(vm.date) ? ' (parcial)' : '') : 'Del ' + fmtDateShort(vm.rangeFrom) + ' al ' + fmtDateShort(vm.rangeTo) + ' (' + vm.rangeDays + ' días)';
  }
  /** Encabezados en la fila 1 y con filtro, listos para compartir (el día o rango va en el nombre del archivo). */
  private hoja(_titulo: string, head: string[], rows: (string | number | null)[][], cols: number[]) {
    const ws = XLSX.utils.aoa_to_sheet([head, ...(rows.length ? rows : [['Sin datos']])]);
    ws['!cols'] = cols.map((w) => ({ wch: w }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: head.length - 1 } }) };
    return ws;
  }
  private bajar(wb: XLSX.WorkBook, nombre: string) {
    descargar(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombre);
  }

  excelDetalle() {
    const vm = this.vm; if (!vm) { aviso('err', 'No hay datos cargados todavía.'); return; }
    try {
      const rows = this.filasDetalle().slice().sort((a, b) => b.count - a.count || (a.sku < b.sku ? -1 : 1));
      const sel = BUCKETS.filter((b) => this.buckets.has(b));
      const motTxt = sel.length ? sel.map((b) => BUCKET_LABEL[b]).join(' + ') : 'Todos los motivos';
      const aoa: (string | number)[][] = rows.map((r) => [r.sku, r.desc, this.um(r.sku), BUCKET_LABEL[r.bucket], r.count]);
      const ws = this.hoja('', ['Código', 'Descripción', 'UM', 'Motivo', 'Veces negado'], aoa, [12, 55, 8, 22, 14]);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Negados');
      const tag = sel.length ? sel.map((b) => ({ positivo: 'Error_proceso', cero: 'Sin_existencia', negativo: 'Inventario_negativo' })[b]).join('_') : 'Todos';
      this.bajar(wb, 'Negados_' + tag + '_' + this.sufijo(vm) + '.xlsx');
      aviso('ok', 'Descargando ' + fmtInt(rows.length) + ' códigos negados (' + motTxt + ')…');
    } catch (err) { console.error(err); aviso('err', 'No se pudo generar el Excel: ' + ((err as Error)?.message || 'error')); }
  }

  excelTop() {
    const vm = this.vm; if (!vm) { aviso('err', 'No hay datos cargados todavía.'); return; }
    try {
      const Q = this.cantidades(vm), pos: Record<string, number> = {}, tot: Record<string, number> = {};
      vm.codes.forEach((c) => { tot[c.sku] = (tot[c.sku] || 0) + c.count; if (c.bucket === 'positivo') pos[c.sku] = (pos[c.sku] || 0) + c.count; });
      const t10 = vm.topCodes.slice(0, 10).map((d, i) => {
        const um = this.um(d.sku), q = Q.has ? Math.round((Q.qty[d.sku] || 0) * umFactor(um) * 100) / 100 : '';
        return [i + 1, d.sku, d.desc, d.count, q, um, tot[d.sku] ? Math.round((pos[d.sku] || 0) / tot[d.sku] * 100) / 100 : ''];
      });
      const ws1 = this.hoja('Top 10 por cantidad de veces negado · ' + this.fechaTxt(vm), ['#', 'Código', 'Descripción', 'Veces negado', 'Unidades negadas', 'UM', 'Con existencia (%)'], t10, [5, 12, 55, 14, 16, 8, 18]);
      for (let r = 1; r < 1 + t10.length; r++) { const c = ws1[XLSX.utils.encode_cell({ r, c: 6 })]; if (c && typeof c.v === 'number') c.z = '0%'; }
      const rows2: (string | number)[][] = [];
      if (!Q.has) rows2.push(['Las unidades negadas se registran desde el 7 oct 2026. Elige un día o rango desde esa fecha.']);
      else {
        const veces: Record<string, number> = {};
        vm.topCodes.forEach((c) => { veces[c.sku] = c.count; });
        const items = Object.keys(Q.qty).map((s) => { const um = this.um(s); return { sku: s, desc: (this.radar.store.skus[s] || [''])[0], um, g: umGrupo(um), q: Q.qty[s] * umFactor(um), v: veces[s] || 0 }; }).filter((i) => i.q > 0 || i.v > 0);
        ([['uni', 'Unidades'], ['pqt', 'Paquetes'], ['m', 'Metros'], ['otr', 'Otras unidades de medida']] as [Grupo, string][]).forEach(([g, t]) => {
          const L = items.filter((i) => i.g === g).sort(g === 'otr' ? (a, b) => b.v - a.v || b.q - a.q : (a, b) => b.q - a.q).slice(0, 5);
          L.forEach((i, k) => rows2.push([t, k + 1, i.sku, i.desc, Math.round(i.q * 100) / 100, g === 'm' ? 'm' : i.um, i.v]));
        });
      }
      const ws2 = this.hoja('Top 5 por cantidad de unidades negadas · ' + this.fechaTxt(vm) + (Q.has && Q.has < Q.n ? ' · unidades de ' + Q.has + ' de ' + Q.n + ' días' : ''), ['Tipo de unidad', '#', 'Código', 'Descripción', 'Cantidad negada', 'UM', 'Veces negado'], rows2, [22, 5, 12, 55, 16, 8, 14]);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws1, 'Top 10 veces'); XLSX.utils.book_append_sheet(wb, ws2, 'Top 5 unidades');
      this.bajar(wb, 'Top_negados_' + this.sufijo(vm) + '.xlsx');
      aviso('ok', 'Descargando Top 10 y Top 5…');
    } catch (err) { console.error(err); aviso('err', 'No se pudo generar el Excel: ' + ((err as Error)?.message || 'error')); }
  }

  /* ---------------- Negados sin actualizar (foto del último Excel) ---------------- */
  private static motivo(v: number) { return v > 0 ? 'Con stock en sistema' : v === 0 ? 'Existencia en 0' : 'Inventario negativo'; }
  private static hora(ms: number) { const d = new Date(ms); return fmtDateShort(ymd(d)) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  renderSinActualizar() {
    const tb = document.getElementById('pnegTbl'), sub = document.getElementById('pnegSub');
    if (!tb || !sub) return;
    const R = sinActualizarPorCodigo(this.radar.store);
    if (!R) { sub.textContent = 'Aparece con el próximo Excel cargado.'; tb.innerHTML = ''; return; }
    const G = R.codigos, lin = G.reduce((a, g) => a + g.n, 0);
    sub.textContent = 'Al corte ' + TopNegados.hora(R.t) + ' · ' + fmtInt(G.length) + ' códigos (' + fmtInt(lin) + ' líneas) en 0 sin actualizar, con existencia suficiente para al menos un pedido';
    tb.innerHTML = '<thead><tr><th>Motivo</th><th>Código</th><th>Descripción</th><th>UM</th><th class="n">Veces</th><th class="n">Cant. pedida</th><th class="n">Disponible</th><th>Ubicación</th><th>Sucursales</th><th class="n">Pedidos</th></tr></thead><tbody>' +
      (G.length ? G.map((g) => '<tr><td><span class="tg ' + (g.disp > 0 ? 's' : 'z') + '">' + TopNegados.motivo(g.disp) + '</span></td><td class="c">' + esc(g.sku) + '</td><td class="ds" title="' + esc(g.desc) + '">' + esc(g.desc) + '</td><td>' + esc(g.um) +
        '</td><td class="n"><b>' + fmtInt(g.n) + '</b></td><td class="n">' + fmtInt(g.q) + '</td><td class="n">' + fmtInt(g.disp || 0) + '</td><td class="c">' + esc(g.ubic.join(' / ')) + '</td><td>' + esc(g.suc.join(', ')) + '</td><td class="n">' + fmtInt(g.pedidos) + '</td></tr>').join('')
        : '<tr class="empty-row"><td colspan="10">No hay líneas en 0 pendientes de actualizar.</td></tr>') + '</tbody>';
  }

  excelSinActualizar() {
    const R = sinActualizarPorCodigo(this.radar.store);
    if (!R) { aviso('err', 'Todavía no hay datos: carga el Rpt_OrdenesPreparacion.'); return; }
    try {
      const ws = this.hoja('', ['Motivo', 'Código', 'Descripción', 'UM', 'Veces', 'Cant. pedida', 'Disponible', 'Ubicación', 'Sucursales', 'Pedidos'],
        R.codigos.map((g) => [TopNegados.motivo(g.disp), g.sku, g.desc, g.um, g.n, g.q, g.disp, g.ubic.join(' / '), g.suc.join(', '), g.pedidos]), [20, 12, 50, 7, 8, 12, 12, 24, 30, 9]);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Negados sin actualizar');
      const d = new Date(R.t), tag = ymd(d) + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
      this.bajar(wb, 'Negados_sin_actualizar_' + tag + '.xlsx');
      aviso('ok', 'Descargando ' + fmtInt(R.codigos.length) + ' códigos…');
    } catch (e) { console.error(e); aviso('err', 'No se pudo generar el Excel.'); }
  }
}
