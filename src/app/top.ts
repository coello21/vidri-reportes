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
import { motivosPorCodigo, negadosPorMotivo, motLabel, motColor, motSort } from '../core/negados/motivos';

/** Fila del detalle: por código y motivo (registrado, o por disponible en días sin motivo). */
interface FilaDet { sku: string; desc: string; bucket: string; label: string; color: string; count: number }
const SIN_DATO = '\u0000sd';
const BUCKET_COLOR: Record<Bucket, string> = { positivo: 'var(--orange)', cero: 'var(--blue)', negativo: 'var(--blue)' };

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
  /** Con motivo registrado en el día o rango: código -> {motivo: veces}; null si no hay. */
  motCod: Record<string, Record<string, number>> | null = null;
  /** Motivos registrados elegidos en el detalle. */
  motSel = new Set<string>();
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
      if (this.motCod) {
        // filtro por motivo registrado
        const k = btn.getAttribute('data-mot'), M = this.motSel;
        if (k == null || k === '*') M.clear(); else if (M.has(k)) M.delete(k); else M.add(k);
        $('bucketFilter').querySelectorAll('button').forEach((x) => { const v = x.getAttribute('data-mot'); x.classList.toggle('active', v === '*' ? !M.size : M.has(v!)); });
        this.renderDetalle();
        return;
      }
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
    document.getElementById('pnegFiltro')?.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return;
      this.pnegFiltro = b.dataset.m ?? 'all';
      this.renderSinActualizar();
    });
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
    const antes = !!this.motCod;
    this.motCod = motivosPorCodigo(this.radar.history, this.diasSel(vm));
    if (antes !== !!this.motCod || this.motCod) this.botonesFiltro();
    if (!this.codigoSel && vm.topCodes.length) this.codigoSel = vm.topCodes[0].sku;
    const m = vm.meta, p = m.fecha ? 'el ' + fechaLarga(m.fecha) + (this.radar.isPartialDay(m.fecha) ? ' (corte parcial)' : '') : 'del ' + fechaLarga(vm.rangeFrom) + ' al ' + fechaLarga(vm.rangeTo);
    const tn = m.totalNegados || 0, top = vm.topCodes.slice(0, 10), s10 = top.reduce((a, c) => a + c.count, 0), p10 = tn ? Math.round(s10 / tn * 100) : 0;
    if (!m.totalFinal) { $('tpTitle').textContent = 'Sin negados ' + p; $('tpLead').textContent = ''; }
    else {
      $('tpTitle').textContent = 'Los 10 códigos más negados suman el ' + p10 + '% de los negados ' + p;
      $('tpLead').innerHTML = '<b>' + fmtInt(s10) + '</b> de ' + fmtInt(tn) + ' líneas negadas. ' + (top.length ? 'El primero, <b>' + esc(top[0].sku) + '</b>, se negó ' + fmtInt(top[0].count) + ' veces. ' : '');
    }
    const tc = vm.topCodes[0], ts = vm.byStore[0];
    $('tpTopCode').textContent = tc ? tc.sku : '—';
    $('tpTopCodeDesc').textContent = tc ? (tc.desc.length > 46 ? tc.desc.slice(0, 46) + '…' : tc.desc) + ' · ' + fmtInt(tc.count) + ' veces' : '—';
    $('tpTopStore').textContent = ts ? ts.name : '—';
    $('tpTopStoreCount').textContent = ts ? fmtInt(ts.count) : '—';
    this.renderRanking1();
    this.renderRanking2();
    this.renderTopMotivo();
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
    const MC = this.motCod;
    let h = '<div class="tw"><table class="rk-tbl"><thead><tr><th>#</th><th>Código</th><th>Descripción</th><th class="n">Veces</th><th class="n">Unidades</th><th' + (MC ? '>Motivo principal' : ' class="n">Con existencia') + '</th><th>Tendencia · ' + days.length + ' días</th></tr></thead><tbody>';
    const motCelda = (sku: string, veces: number) => {
      const m = MC && MC[sku];
      if (!m) return '<td class="q">sin motivo registrado</td>';
      const k = Object.keys(m).sort((a, b) => m[b] - m[a] || motSort(a, b))[0], otros = Object.keys(m).length - 1;
      return '<td class="mp" title="' + esc(Object.keys(m).sort(motSort).map((x) => motLabel(x) + ': ' + m[x]).join(' · ')) + '"><i style="background:' + motColor(k) + '"></i>' + esc(motLabel(k)) +
        ' <b>' + Math.round(m[k] / veces * 100) + '%</b>' + (otros > 0 ? '<span> +' + otros + '</span>' : '') + '</td>';
    };
    list.forEach((d, i) => {
      const um = this.um(d.sku), g = umGrupo(um), q = Q.has ? (Q.qty[d.sku] || 0) * umFactor(um) : null, sp = sparkProm(this.vecesPorDia(d.sku, days), part, '#E0262B');
      h += '<tr class="clk' + (d.sku === this.codigoSel ? ' sel' : '') + '" data-sku="' + esc(d.sku) + '"><td class="n0">' + (i + 1) + '</td><td class="sku">' + esc(d.sku) + '</td><td>' + esc(d.desc) +
        '</td><td class="n"><b>' + fmtInt(d.count) + '</b></td><td class="n">' + (q == null ? '—' : qtyFmt(q, g === 'otr' ? '' : g) + (g === 'otr' ? ' ' + esc(um) : '')) +
        '</td>' + (MC ? motCelda(d.sku, d.count) : '<td class="n">' + Math.round((pos[d.sku] || 0) / d.count * 100) + '%</td>') + '<td class="trc">' + (sp ? sp.svg + '<span>' + promTxt(sp.avg) + '</span>' : '') + '</td></tr>';
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
        const sp = otr ? sparkProm(this.vecesPorDia(i.sku, days), part, '#1E3A6E') : sparkProm(this.cantidadPorDia(i.sku, daysQ), partQ, '#1E3A6E');
        const qtxt = otr ? fmtInt(i.q) + ' ' + esc(i.um) : qtyFmt(i.q, gr.g);
        h += '<tr class="clk" data-sku="' + esc(i.sku) + '"><td class="sku">' + esc(i.sku) + '</td><td>' + esc(i.desc) + '</td><td class="n"><b>' + (otr ? fmtInt(i.v) : qtxt) + '</b></td><td class="n">' +
          (otr ? qtxt : fmtInt(i.v)) + '</td><td class="trc">' + (sp ? sp.svg + '<span>' + promTxt(sp.avg, otr ? 'veces' : gr.g === 'm' ? 'm' : gr.g === 'pqt' ? 'PQT' : 'uni') + '</span>' : '') + '</td></tr>';
      });
      return h + '</tbody></table></div></div>';
    }).join('');
    box.querySelectorAll<HTMLElement>('tr.clk').forEach((r) => r.addEventListener('click', () => this.elegirCodigo(r.dataset.sku!)));
  }

  /** Ranking 3: los 5 códigos más negados de cada motivo registrado. */
  private renderTopMotivo() {
    const el = $('topMot'), MC = this.motCod;
    if (!MC) { el.innerHTML = '<p class="q">Aparece con el motivo de negado registrado (desde el 27 oct 2026). Elige un día o rango desde esa fecha.</p>'; return; }
    const por: Record<string, { sku: string; n: number }[]> = {}, tot: Record<string, number> = {};
    for (const sku in MC) for (const k in MC[sku]) { (por[k] || (por[k] = [])).push({ sku, n: MC[sku][k] }); tot[k] = (tot[k] || 0) + MC[sku][k]; }
    const desc = (sku: string) => (this.radar.store.skus[sku] || [''])[0] || '';
    el.innerHTML = Object.keys(por).sort(motSort).map((k) => {
      const L = por[k].sort((a, b) => b.n - a.n || (a.sku < b.sku ? -1 : 1)).slice(0, 5);
      return '<div class="r2"><h4><i class="mdot" style="background:' + motColor(k) + '"></i>' + esc(motLabel(k)) + ' <span>' + fmtInt(tot[k]) + ' líneas</span></h4>' +
        '<div class="tw"><table class="rk-tbl"><thead><tr><th>Código</th><th>Descripción</th><th class="n">Veces</th></tr></thead><tbody>' +
        L.map((x) => '<tr class="clk" data-sku="' + esc(x.sku) + '"><td class="sku">' + esc(x.sku) + '</td><td title="' + esc(desc(x.sku)) + '">' + esc(desc(x.sku)) + '</td><td class="n"><b>' + fmtInt(x.n) + '</b></td></tr>').join('') +
        '</tbody></table></div></div>';
    }).join('');
    el.querySelectorAll<HTMLElement>('tr.clk').forEach((r) => r.addEventListener('click', () => this.elegirCodigo(r.dataset.sku!)));
  }

  private renderSucursales() {
    const el = $('storeBars'), list = this.vm!.byStore.slice(0, 12);
    if (!list.length) { el.innerHTML = '<div class="empty-row"><td>Sin datos</td></div>'; return; }
    const max = Math.max(...list.map((d) => d.count), 1);
    el.innerHTML = list.map((d) => '<div class="barrow"><span class="code" style="font-family:var(--font-body);font-size:12px;">' + esc(d.name) + '</span><span class="track" title="' + esc(d.name) + ' — ' + d.count +
      ' negados"><span class="fill" style="width:' + Math.max(3, d.count / max * 100) + '%;background:var(--steel);"></span></span><span class="num tabular">' + d.count + '</span></div>').join('');
  }

  /** Filas del detalle con los motivos y la búsqueda elegidos. */
  filasDetalle(): FilaDet[] {
    let rows: FilaDet[];
    const MC = this.motCod;
    if (MC) {
      // por código y motivo registrado; lo que no tiene registro (días anteriores) va como "Sin dato"
      const tot = new Map<string, { desc: string; n: number }>();
      (this.vm?.codes || []).forEach((c) => { const t = tot.get(c.sku) || { desc: c.desc, n: 0 }; t.n += c.count; tot.set(c.sku, t); });
      rows = [];
      tot.forEach((t, sku) => {
        const m = MC[sku] || {};
        let reg = 0;
        for (const k in m) { reg += m[k]; rows.push({ sku, desc: t.desc, bucket: k, label: motLabel(k), color: motColor(k), count: m[k] }); }
        if (t.n > reg) rows.push({ sku, desc: t.desc, bucket: SIN_DATO, label: 'Sin dato', color: '#A39C90', count: t.n - reg });
      });
      if (this.motSel.size) rows = rows.filter((r) => this.motSel.has(r.bucket));
    } else {
      rows = (this.vm?.codes || []).map((c) => ({ sku: c.sku, desc: c.desc, bucket: c.bucket, label: BUCKET_LABEL[c.bucket], color: BUCKET_COLOR[c.bucket], count: c.count }));
      if (this.buckets.size) rows = rows.filter((r) => this.buckets.has(r.bucket as Bucket));
    }
    if (this.busqueda) { const q = normText(this.busqueda); rows = rows.filter((r) => normText(r.sku).includes(q) || normText(r.desc).includes(q)); }
    // top general: una fila por código con el total de veces (de los motivos elegidos); motivo = el principal (+ cuántos más)
    const por = new Map<string, FilaDet[]>();
    rows.forEach((r) => { const l = por.get(r.sku); if (l) l.push(r); else por.set(r.sku, [r]); });
    return [...por.values()].map((l) => {
      const p = l.slice().sort((a, b) => b.count - a.count)[0], n = l.reduce((a, r) => a + r.count, 0);
      return { ...p, count: n, label: p.label + (l.length > 1 ? ' +' + (l.length - 1) : '') };
    });
  }

  /** Botones del filtro del detalle: por motivo registrado si lo hay; si no, por disponible (como antes). */
  private botonesFiltro() {
    const seg = $('bucketFilter');
    if (this.motCod) {
      const ks = new Set<string>();
      Object.values(this.motCod).forEach((m) => Object.keys(m).forEach((k) => ks.add(k)));
      [...this.motSel].forEach((k) => { if (!ks.has(k) && k !== SIN_DATO) this.motSel.delete(k); });
      const L = [...ks].sort(motSort).map((k) => [k, motLabel(k)]).concat([[SIN_DATO, 'Sin dato']]);
      seg.setAttribute('aria-label', 'Filtrar por motivo registrado');
      seg.innerHTML = '<button data-mot="*"' + (!this.motSel.size ? ' class="active"' : '') + '>Todos</button>' +
        L.map(([k, l]) => '<button data-mot="' + esc(k) + '"' + (this.motSel.has(k) ? ' class="active"' : '') + '>' + esc(l) + '</button>').join('');
    } else if (!seg.querySelector('[data-bucket]')) {
      this.buckets.clear();
      seg.setAttribute('aria-label', 'Filtrar por disponibilidad');
      seg.innerHTML = '<button data-bucket="all" class="active">Todos</button><button data-bucket="positivo">Error en el proceso</button><button data-bucket="cero">Sin existencia</button><button data-bucket="negativo">Inventario negativo</button>';
    }
  }

  private renderDetalle() {
    if (!this.vm) return;
    const { key, dir } = this.orden;
    const rows = this.filasDetalle().slice().sort((a, b) => {
      let av: string | number = key === 'bucket' ? a.label : a[key], bv: string | number = key === 'bucket' ? b.label : b[key];
      if (typeof av === 'string') { av = av.toLowerCase(); bv = String(bv).toLowerCase(); }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    const body = $('tableBody');
    body.innerHTML = rows.length ? rows.slice(0, 500).map((r) => '<tr class="' + (r.sku === this.codigoSel ? 'selected' : '') + '" data-sku="' + esc(r.sku) + '"><td class="code">' + esc(r.sku) + '</td><td class="desc">' + esc(r.desc) +
      '</td><td><span class="pill"><span class="dot" style="background:' + r.color + '"></span>' + esc(r.label) + '</span></td><td class="count tabular">' + r.count + '</td></tr>').join('')
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
      const sel = this.motCod ? [...this.motSel].map((k) => (k === SIN_DATO ? 'Sin dato' : motLabel(k))) : BUCKETS.filter((b) => this.buckets.has(b)).map((b) => BUCKET_LABEL[b]);
      const motTxt = sel.length ? sel.join(' + ') : 'Todos los motivos';
      const aoa: (string | number)[][] = rows.map((r) => [r.sku, r.desc, this.um(r.sku), r.label, r.count]);
      const ws = this.hoja('', ['Código', 'Descripción', 'UM', 'Motivo', 'Veces negado'], aoa, [12, 55, 8, 22, 14]);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Negados');
      const tag = sel.length ? sel.map((x) => x.replace(/[^A-Za-zÁÉÍÓÚáéíóúñÑ0-9]+/g, '_')).join('_') : 'Todos';
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
        const m = this.motCod && this.motCod[d.sku];
        const mp = m ? Object.keys(m).sort((a, b) => m[b] - m[a] || motSort(a, b)).map((k) => motLabel(k) + ' ' + m[k]).join(' · ') : 'sin motivo registrado';
        return [i + 1, d.sku, d.desc, d.count, q, um, this.motCod ? mp : tot[d.sku] ? Math.round((pos[d.sku] || 0) / tot[d.sku] * 100) / 100 : ''];
      });
      const ws1 = this.hoja('Top 10 por cantidad de veces negado · ' + this.fechaTxt(vm), ['#', 'Código', 'Descripción', 'Veces negado', 'Unidades negadas', 'UM', this.motCod ? 'Motivos registrados' : 'Con existencia (%)'], t10, [5, 12, 55, 14, 16, 8, this.motCod ? 50 : 18]);
      if (!this.motCod) for (let r = 1; r < 1 + t10.length; r++) { const c = ws1[XLSX.utils.encode_cell({ r, c: 6 })]; if (c && typeof c.v === 'number') c.z = '0%'; }
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
      if (this.motCod) {
        const MC = this.motCod, por: Record<string, { sku: string; n: number }[]> = {};
        for (const sku in MC) for (const k in MC[sku]) (por[k] || (por[k] = [])).push({ sku, n: MC[sku][k] });
        const rows3: (string | number)[][] = [];
        Object.keys(por).sort(motSort).forEach((k) => por[k].sort((a, b) => b.n - a.n).slice(0, 5).forEach((x, i) => rows3.push([motLabel(k), i + 1, x.sku, (this.radar.store.skus[x.sku] || [''])[0] || '', x.n])));
        XLSX.utils.book_append_sheet(wb, this.hoja('Top 5 por motivo de negado · ' + this.fechaTxt(vm), ['Motivo', '#', 'Código', 'Descripción', 'Veces negado'], rows3, [32, 5, 12, 55, 14]), 'Top 5 por motivo');
      }
      this.bajar(wb, 'Top_negados_' + this.sufijo(vm) + '.xlsx');
      aviso('ok', 'Descargando Top 10 y Top 5…');
    } catch (err) { console.error(err); aviso('err', 'No se pudo generar el Excel: ' + ((err as Error)?.message || 'error')); }
  }

  /* ---------------- Negados sin actualizar (foto del último Excel) ---------------- */
  /** Motivo elegido en la tabla de negados sin actualizar. */
  pnegFiltro = 'all';
  private static motivo(v: number) { return v > 0 ? 'Error en el proceso' : v === 0 ? 'Sin existencia' : 'Inventario negativo'; }
  private static tagMotivo(v: number) { return v > 0 ? 's' : v === 0 ? 'z' : 'n'; }
  private static hora(ms: number) { const d = new Date(ms); return fmtDateShort(ymd(d)) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  renderSinActualizar() {
    const tb = document.getElementById('pnegTbl'), sub = document.getElementById('pnegSub');
    if (!tb || !sub) return;
    const R = sinActualizarPorCodigo(this.radar.store);
    if (!R) { sub.textContent = 'Aparece con el próximo Excel cargado.'; tb.innerHTML = ''; return; }
    // con motivo registrado (Excel que trae la columna) se filtra y se muestra por ese motivo; si no, por el disponible como antes
    const T = R.codigos, conMot = T.some((g) => g.motReg != null);
    const clave = (g: typeof T[number]) => (conMot ? g.motReg ?? '' : g.motivo);
    const seg = document.getElementById('pnegFiltro')!;
    const claves = conMot ? [...new Set(T.map((g) => g.motReg ?? ''))].sort(motSort) : ['positivo', 'cero', 'negativo'];
    if (!['all', ...claves].includes(this.pnegFiltro)) this.pnegFiltro = 'all';
    const nombre = (m: string) => (m === 'all' ? 'Todos' : conMot ? motLabel(m) : ({ positivo: 'Error en el proceso', cero: 'Sin existencia', negativo: 'Inventario negativo' } as Record<string, string>)[m]);
    seg.innerHTML = ['all', ...claves].map((m) => '<button data-m="' + esc(m) + '"' + (m === this.pnegFiltro ? ' class="active"' : '') + '>' + esc(nombre(m)) + '<span>(' + fmtInt(m === 'all' ? T.length : T.filter((g) => clave(g) === m).length) + ')</span></button>').join('');
    const G = this.pnegFiltro === 'all' ? T : T.filter((g) => clave(g) === this.pnegFiltro), lin = G.reduce((a, g) => a + g.n, 0);
    sub.textContent = 'Al corte ' + TopNegados.hora(R.t) + ' · ' + fmtInt(G.length) + ' códigos (' + fmtInt(lin) + ' líneas) negados en 0 que todavía no pasan a actualizado · ' +
      (conMot ? 'Motivo = el que registró el preparador · ' : '') + 'Disponible = existencia en el último Excel';
    const tag = (g: typeof T[number]) => conMot
      ? '<span class="tg m"><i style="background:' + motColor(g.motReg ?? '') + '"></i>' + esc(motLabel(g.motReg ?? '')) + '</span>'
      : '<span class="tg ' + TopNegados.tagMotivo(g.disp) + '">' + TopNegados.motivo(g.disp) + '</span>';
    tb.innerHTML = '<thead><tr><th>Motivo</th><th>Código</th><th>Descripción</th><th>UM</th><th class="n">Veces</th><th class="n">Cant. pedida</th><th class="n">Disponible</th><th>Última revisión</th><th>Ubicación</th><th>Sucursales</th><th class="n">Pedidos</th></tr></thead><tbody>' +
      (G.length ? G.map((g) => '<tr><td>' + tag(g) + '</td><td class="c">' + esc(g.sku) + '</td><td class="ds" title="' + esc(g.desc) + '">' + esc(g.desc) + '</td><td>' + esc(g.um) +
        '</td><td class="n"><b>' + fmtInt(g.n) + '</b></td><td class="n">' + fmtInt(g.q) + '</td><td class="n">' + fmtInt(g.disp || 0) + '</td><td class="c">' + TopNegados.hora(g.rev) + '</td><td class="c">' + esc(g.ubic.join(' / ')) + '</td><td>' + esc(g.suc.join(', ')) + '</td><td class="n">' + fmtInt(g.pedidos) + '</td></tr>').join('')
        : '<tr class="empty-row"><td colspan="11">No hay líneas negadas pendientes de actualizar' + (this.pnegFiltro === 'all' ? '' : ' con este motivo') + '.</td></tr>') + '</tbody>';
  }

  excelSinActualizar() {
    const R = sinActualizarPorCodigo(this.radar.store);
    if (!R) { aviso('err', 'Todavía no hay datos: carga el Rpt_OrdenesPreparacion.'); return; }
    try {
      const ws = this.hoja('', ['Motivo', 'Código', 'Descripción', 'UM', 'Veces', 'Cant. pedida', 'Disponible', 'Última revisión', 'Ubicación', 'Sucursales', 'Pedidos'],
        R.codigos.map((g) => [g.motReg != null ? motLabel(g.motReg) : TopNegados.motivo(g.disp), g.sku, g.desc, g.um, g.n, g.q, g.disp, null, g.ubic.join(' / '), g.suc.join(', '), g.pedidos]), [20, 12, 50, 7, 8, 12, 12, 17, 24, 30, 9]);
      // Última revisión del código como fecha y hora de Excel (se puede filtrar y ordenar)
      R.codigos.forEach((g, i) => { const d = new Date(g.rev); ws[XLSX.utils.encode_cell({ r: i + 1, c: 7 })] = { t: 'n', v: (g.rev - d.getTimezoneOffset() * 60000) / 864e5 + 25569, z: 'dd/mm/yyyy hh:mm' }; });
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Negados sin actualizar');
      const d = new Date(R.t), tag = ymd(d) + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
      this.bajar(wb, 'Negados_sin_actualizar_' + tag + '.xlsx');
      aviso('ok', 'Descargando ' + fmtInt(R.codigos.length) + ' códigos…');
    } catch (e) { console.error(e); aviso('err', 'No se pudo generar el Excel.'); }
  }
}
