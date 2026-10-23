/**
 * Pestaña "Resumen" del Radar de Negados, rehecha en TypeScript con la misma
 * apariencia y las mismas reglas que el tablero original.
 */
import * as XLSX from 'xlsx';
import { aviso, descargar } from './ui/avisos';
import type { RadarNegados, VistaAgregada, PreparadorVista } from '../core/negados/radar';
import { parsePreparadorName, EXACTITUD_META } from '../core/negados/radar';
import { addDays } from '../core/comun/fechas';
import { lineasPreparadas } from '../core/negados/extras';
import { $, esc, fmtInt, fmtPct, fmtDateShort, fechaLarga } from './ui/formato';
import { barrasApiladas, tendenciaSobrePuntos, globoEnPuntos } from './ui/graficos';

type ClaveOrden = 'name' | 'solicitado' | 'preparados' | 'negados' | 'fillRate';

export class Resumen {
  vm: VistaAgregada | null = null;
  desde: string | null = null;
  hasta: string | null = null;
  prepSel: string | null = null;
  orden: { key: ClaveOrden; dir: 'asc' | 'desc' } = { key: 'solicitado', dir: 'desc' };
  /** Avisa a las otras pestañas que cambió el día o rango elegido. */
  alCambiar: ((vm: VistaAgregada) => void) | null = null;

  constructor(private radar: RadarNegados) {
    this.conectar();
  }

  private get fechas() { return this.radar.dias(); }

  /* ---------------- arranque y selección ---------------- */
  iniciar() {
    const d = this.radar.lastCompleteDay();
    if (d) this.elegir(d, d);
    else { this.renderUpdatedAt(); this.renderTrend(); this.renderDayChips(); this.renderRangeControls(); }
    document.body.classList.toggle('nodata', !d);
  }

  elegir(from: string, to: string) {
    if (from > to) [from, to] = [to, from];
    const vm = this.radar.agregado(from, to);
    if (!vm) return;
    this.desde = from; this.hasta = to;
    this.render(vm);
    this.renderTrend();
    this.renderDayChips();
    this.renderRangeControls();
    this.alCambiar?.(vm);
  }

  private conectar() {
    $('dayChips').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.daychip');
      const d = b?.dataset.date;
      if (d && this.radar.history[d]) this.elegir(d, d);
    });
    const aplicar = () => {
      const f = ($('rangeFromSel') as HTMLSelectElement).value, t = ($('rangeToSel') as HTMLSelectElement).value;
      if (f && t) this.elegir(f, t);
    };
    $('applyRangeBtn').addEventListener('click', aplicar);
    $('rangeFromSel').addEventListener('change', aplicar);
    $('rangeToSel').addEventListener('change', aplicar);
    $('monthSel').addEventListener('change', (e) => {
      const mo = (e.target as HTMLSelectElement).value;
      if (!mo) return;
      const ds = this.fechas.filter((d) => d.slice(0, 7) === mo);
      if (ds.length) this.elegir(ds[0], ds[ds.length - 1]);
    });
    $('allRangeBtn').addEventListener('click', () => {
      const ds = this.fechas;
      if (ds.length) this.elegir(ds[0], ds[ds.length - 1]);
    });
    document.querySelectorAll<HTMLElement>('#fillRateTable thead th').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.key as ClaveOrden;
        if (this.orden.key === key) this.orden.dir = this.orden.dir === 'asc' ? 'desc' : 'asc';
        else this.orden = { key, dir: key === 'name' ? 'asc' : 'desc' };
        this.renderFillRateTable();
      });
    });
    document.getElementById('downloadFillRateBtn')?.addEventListener('click', () => this.excelPreparadores());
    let t: number | undefined;
    window.addEventListener('resize', () => { clearTimeout(t); t = window.setTimeout(() => { if (this.vm) this.renderMotivo(this.vm); }, 150); });
  }

  /* ---------------- encabezado y tarjetas ---------------- */
  private periodo(vm: VistaAgregada): string {
    const f = vm.meta.fecha;
    if (f) return 'el ' + fechaLarga(f) + (this.radar.isPartialDay(f) ? ' (corte parcial)' : '');
    return 'del ' + fechaLarga(vm.rangeFrom) + ' al ' + fechaLarga(vm.rangeTo);
  }

  render(vm: VistaAgregada) {
    this.vm = vm;
    const m = vm.meta;
    if (m.fecha) {
      $('dataDate').textContent = new Date(m.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' }) + (this.radar.isPartialDay(m.fecha) ? ' (parcial)' : '');
    } else {
      const f = new Date(vm.rangeFrom + 'T12:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
      const t = new Date(vm.rangeTo + 'T12:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
      $('dataDate').textContent = f + ' – ' + t + ' (' + vm.rangeDays + ' días combinados)';
    }
    $('branchCount').textContent = m.branchCount + ' sucursales';
    $('kpiTotal').textContent = fmtInt(m.totalFinal);
    $('kpiDupesFoot').innerHTML = vm.legacyDays
      ? '<b>' + fmtInt(m.dedupPedidoSku || 0) + '</b> por Pedido+SKU &middot; <b>' + fmtInt(m.dedupOrdenSku || 0) + '</b> por Orden+SKU' + (vm.newDays ? ' (versión anterior)' : '')
      : 'Solo listas para despacho (estado A)';
    $('kpiNegados').textContent = fmtInt(m.totalNegados);
    $('kpiPct').textContent = fmtPct(m.pct) + ' del total';
    this.renderExactitud(vm);
    this.renderB2B(vm);
    this.renderUpdatedAt();

    const top = vm.topCodes[0];
    $('kpiTopCode').textContent = top ? top.sku : '—';
    $('kpiTopCodeDesc').textContent = top ? (top.desc.length > 46 ? top.desc.slice(0, 46) + '…' : top.desc) + ' · ' + top.count + ' veces' : '—';
    const st = vm.byStore[0];
    $('kpiTopStore').textContent = st ? st.name : '—';
    $('kpiTopStoreCount').textContent = st ? fmtInt(st.count) : '—';
    $('kpiFalloProceso').textContent = fmtInt(vm.bucketCounts.positivo || 0);

    this.renderNegPrepCompare(vm);
    this.renderNegPrepTrend();
    this.renderFillRateTable();
    this.renderTitular(vm);
    this.tarjetasEnLineas(vm);
  }

  /** Tarjetas en líneas (diseño del 20 oct) y Líneas preparadas por Fecha Enviado Revisión. */
  private tarjetasEnLineas(vm: VistaAgregada) {
    const m = vm.meta, tot = m.totalFinal || 0, neg = m.totalNegados || 0, prep = m.totalPreparados != null ? m.totalPreparados : Math.max(tot - neg, 0);
    const pc = (v: number) => (tot ? fmtPct(v / tot * 100) : '—');
    $('kpiTotal').textContent = fmtInt(prep);
    $('kpiDupesFoot').innerHTML = 'de <b>' + fmtInt(tot) + '</b> líneas (' + pc(prep) + ')';
    $('kpiPct').parentElement!.innerHTML = '<b id="kpiPct">' + pc(neg) + '</b> de ' + fmtInt(tot) + ' líneas cerradas';
    const bc = vm.bucketCounts, pos = bc.positivo || 0, pp = neg ? Math.round(pos / neg * 100) : 0;
    $('vxFalloFoot').innerHTML = '<b>' + pp + '%</b> de las negadas · había stock';
    $('vxSinStockFoot').innerHTML = '<b>' + (neg ? 100 - pp : 0) + '%</b> · ' + fmtInt(bc.cero || 0) + ' en 0 y ' + fmtInt(bc.negativo || 0) + ' negativo';
    if (m.prepEval && vm.newDays) $('kpiExactFoot').innerHTML = '<b>' + fmtInt(m.exactas) + '</b> de ' + fmtInt(m.prepEval) + ' completas <span class="meta-tag">meta ≥ 99,5%</span>';
    const lp = lineasPreparadas(this.radar.store, vm.date || vm.rangeFrom, vm.date || vm.rangeTo);
    $('kpiTotal').textContent = lp == null ? '—' : fmtInt(lp);
    $('kpiDupesFoot').innerHTML = '<b>' + fmtInt(tot) + '</b> líneas actualizadas';
  }

  private renderTitular(vm: VistaAgregada) {
    const m = vm.meta, p = this.periodo(vm);
    $('rsEyebrow').textContent = 'Motivo de los negados · ' + (p.replace(/^(el|del) /, '') || '—');
    const bc = vm.bucketCounts, tn = m.totalNegados || 0, pos = bc.positivo || 0, sin = (bc.cero || 0) + (bc.negativo || 0);
    const pp = tn ? Math.round(pos / tn * 100) : 0, ps = tn ? 100 - pp : 0;
    $('vxSinStock').textContent = fmtInt(sin);
    $('vxFalloFoot').innerHTML = '<b>' + pp + '%</b> de los negados · había stock en sistema y no se encontró';
    $('vxSinStockFoot').innerHTML = '<b>' + ps + '%</b> de los negados · disponible en 0 o negativo';
    const t = $('rsTitle'), l = $('rsLead');
    if (!m.totalFinal) { t.textContent = 'Sin líneas cerradas ' + p; l.textContent = ''; return; }
    t.textContent = pp >= ps
      ? pp + '% de los negados ' + p + ' fue error en el proceso: había stock y no se encontró'
      : ps + '% de los negados ' + p + ' fue por falta de stock';
    const st = vm.byStore[0];
    l.innerHTML = 'Se negaron <b>' + fmtInt(tn) + '</b> de ' + fmtInt(m.totalFinal) + ' líneas listas para despacho (' + fmtPct(m.pct) + '). <b>' + fmtInt(pos) +
      '</b> fueron error en el proceso y <b>' + fmtInt(sin) + '</b> fueron por falta de stock (disponible en 0 o negativo).' +
      (st ? ' La sucursal más afectada fue <b>' + esc(st.name) + '</b>.' : '');
    this.renderMotivo(vm);
  }

  private renderExactitud(vm: VistaAgregada) {
    const card = $('kpiExactCard'), val = $('kpiExact'), foot = $('kpiExactFoot');
    card.classList.remove('ok', 'bad');
    const pct = this.radar.exactitud(vm), lc = this.radar.store.legacyCutoff;
    if (pct == null) {
      val.textContent = '—';
      foot.textContent = 'Disponible desde el ' + (lc ? fmtDateShort(addDays(lc, 1)) : 'próximo reporte');
      return;
    }
    card.classList.add(pct >= EXACTITUD_META ? 'ok' : 'bad');
    val.textContent = fmtPct(pct);
    foot.innerHTML = '<b>' + fmtInt(vm.meta.exactas) + '</b> de ' + fmtInt(vm.meta.prepEval) + ' líneas completas <span class="meta-tag">meta ≥ 99,5%</span>' +
      (vm.legacyDays && lc ? ' · desde el ' + fmtDateShort(addDays(lc, 1)) : '');
  }

  /** Fill rate general (líneas preparadas ÷ líneas cerradas) y abajo el fill rate B2B (pedidos corporativos completos). */
  private renderB2B(vm: VistaAgregada) {
    const val = $('kpiB2B'), foot = $('kpiB2BFoot');
    const m = vm.meta, tot = m.totalFinal || 0, neg = m.totalNegados || 0, prep = m.totalPreparados != null ? m.totalPreparados : Math.max(tot - neg, 0);
    const r = this.radar.fillRateB2B(vm.rangeFrom, vm.rangeTo), lc = this.radar.store.legacyCutoff;
    val.textContent = tot ? fmtPct(prep / tot * 100) : '—';
    const gen = tot ? '<b>' + fmtInt(prep) + '</b> de ' + fmtInt(tot) + ' líneas' : 'Sin líneas cerradas';
    const b2b = r.tot ? 'B2B <b>' + fmtPct(r.ok / r.tot * 100) + '</b> · <b>' + fmtInt(r.ok) + '</b> de ' + fmtInt(r.tot) + ' pedidos'
      : vm.newDays ? 'B2B: sin pedidos corporativos cerrados' : 'B2B disponible desde el ' + (lc ? fmtDateShort(addDays(lc, 1)) : 'próximo reporte');
    foot.innerHTML = gen + '<br>' + b2b;
  }

  private renderUpdatedAt() {
    const el = $('updatedAt'), u = this.radar.store.updatedAt;
    if (u) {
      const d = new Date(u);
      el.textContent = 'Actualizado ' + d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit' });
      el.hidden = false;
    } else el.hidden = true;
  }

  /* ---------------- selector de días y rango ---------------- */
  renderDayChips() {
    const el = $('dayChips'), all = this.fechas;
    if (!all.length) { el.innerHTML = '<div class="history-empty">Aún no hay días guardados.</div>'; return; }
    const L14 = addDays(all[all.length - 1], -13), dates = all.filter((d) => d >= L14), prev = el.scrollLeft;
    el.innerHTML = dates.map((d) => {
      const rec = this.radar.vistaDia(d), m = rec.meta;
      const active = this.desde && this.hasta && d >= this.desde && d <= this.hasta ? ' active' : '';
      const partial = this.radar.isPartialDay(d), legacy = this.radar.isLegacyDay(d);
      const title = fmtInt(m.totalNegados) + ' negados de ' + fmtInt(m.totalFinal) + ' líneas' +
        (partial ? ' — día parcial: falta cargar el reporte que lo completa' : '') + (legacy ? ' — calculado con la versión anterior' : '');
      return '<button class="daychip' + active + (partial ? ' partial' : '') + (legacy ? ' legacy' : '') + '" data-date="' + d + '" title="' + title + '">' +
        '<span class="d">' + fmtDateShort(d) + '</span><span class="n">' + fmtInt(m.totalNegados) + ' <small>negados</small></span>' +
        (partial ? '<span class="tag">Parcial</span>' : '') + '</button>';
    }).join('');
    const act = el.querySelectorAll('.daychip.active');
    el.scrollLeft = prev;
    if (act.length) {
      const er = el.getBoundingClientRect(), last = act[act.length - 1].getBoundingClientRect(), first = act[0].getBoundingClientRect();
      const right = last.right - er.left + el.scrollLeft, left = first.left - er.left + el.scrollLeft;
      if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 12;
      else if (left < el.scrollLeft) el.scrollLeft = Math.max(0, left - 12);
      const chips = [...el.querySelectorAll('.daychip')];
      if (chips.slice(-3).includes(act[act.length - 1])) el.scrollLeft = el.scrollWidth;
    }
  }

  renderRangeControls() {
    const dates = this.fechas;
    const fromSel = $('rangeFromSel') as HTMLSelectElement, toSel = $('rangeToSel') as HTMLSelectElement, monthSel = $('monthSel') as HTMLSelectElement;
    const opts = dates.map((d) => '<option value="' + d + '">' + fmtDateShort(d) + '</option>').join('');
    fromSel.innerHTML = opts; toSel.innerHTML = opts;
    if (this.desde) fromSel.value = this.desde;
    if (this.hasta) toSel.value = this.hasta;
    const months = Array.from(new Set(dates.map((d) => d.slice(0, 7)))).sort().reverse();
    monthSel.innerHTML = '<option value="">Elegir…</option>' + months.map((mo) => {
      const label = new Date(mo + '-15T12:00:00').toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
      return '<option value="' + mo + '">' + label.charAt(0).toUpperCase() + label.slice(1) + '</option>';
    }).join('');
    const enMes = (mo: string) => dates.filter((d) => d.slice(0, 7) === mo);
    monthSel.value = months.find((mo) => { const ds = enMes(mo); return ds.length > 1 && ds[0] === this.desde && ds[ds.length - 1] === this.hasta; }) || '';
    const st = $('rangeStatus');
    if (!dates.length || !this.desde || !this.hasta) { st.innerHTML = ''; return; }
    const n = this.radar.diasEnRango(this.desde, this.hasta).length;
    st.innerHTML = this.desde === this.hasta
      ? 'Viendo: <b>' + fmtDateShort(this.desde) + '</b> (1 día)'
      : 'Viendo: <b>' + fmtDateShort(this.desde) + ' – ' + fmtDateShort(this.hasta) + '</b> (' + n + ' días combinados)';
  }

  /* ---------------- gráficos ---------------- */
  renderMotivo(vm: VistaAgregada) {
    const el = $('vxMot');
    if ($('tab-resumen').hidden) return;
    const all = this.fechas;
    let days: string[];
    if (vm.meta.fecha) { const end = vm.meta.fecha; days = all.filter((d) => d <= end).slice(-30); }
    else days = all.filter((d) => d >= vm.rangeFrom && d <= vm.rangeTo);
    if (days.length < 2) { const end = days[0] || all[all.length - 1]; days = all.filter((d) => d <= end).slice(-30); }
    const pos: number[] = [], sin: number[] = [], part = new Set<number>();
    days.forEach((d, i) => {
      const b = this.radar.vistaDia(d).bucketCounts;
      pos.push(b.positivo || 0); sin.push((b.cero || 0) + (b.negativo || 0));
      if (this.radar.isPartialDay(d)) part.add(i);
    });
    // se muestran los últimos 7 días, sin línea de tendencia (diseño del 20 oct)
    const k = Math.max(0, days.length - 7), d7 = days.slice(k), p7 = new Set([...part].map((i) => i - k).filter((i) => i >= 0));
    barrasApiladas(el, d7, [
      { name: 'Error en el proceso', color: '#DE7A2C', tcolor: '#B5591A', vals: pos.slice(k) },
      { name: 'Sin stock', color: '#3A76B0', tcolor: '#24557F', vals: sin.slice(k) },
    ], { partial: p7, noTrend: true, unit: 'líneas negadas', sel: vm.meta.fecha, onClick: (i) => this.elegir(d7[i], d7[i]) });
    $('vxMotT').textContent = 'Negados por motivo · últimos 7 días';
    document.querySelectorAll<HTMLElement>('#vxMotCard .leg i.dash').forEach((i) => { i.parentElement!.style.display = 'none'; });
  }

  renderTrend() {
    const svg = $('trendSvg') as unknown as SVGSVGElement, dates = this.fechas, W = 800, H = 90, pad = 14;
    if (dates.length < 2) {
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.innerHTML = '<text x="' + W / 2 + '" y="' + (H / 2 + 4) + '" text-anchor="middle" font-size="12" fill="var(--ink-muted)" font-family="var(--font-body)">' + (dates.length ? 'Sube otro día para ver la tendencia' : 'Sin datos aún') + '</text>';
      return;
    }
    const vals = dates.map((d) => this.radar.vistaDia(d).meta.totalNegados || 0), max = Math.max(...vals, 1);
    const pts = dates.map((d, i) => ({ d, x: pad + i / (dates.length - 1) * (W - 2 * pad), y: H - pad - (vals[i] / max) * (H - 2 * pad - 10), count: vals[i] }));
    const line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    const area = line + ' L ' + pts[pts.length - 1].x.toFixed(1) + ' ' + (H - pad) + ' L ' + pts[0].x.toFixed(1) + ' ' + (H - pad) + ' Z';
    const dots = pts.map((p) => {
      const s = !!(this.desde && this.hasta && p.d >= this.desde && p.d <= this.hasta);
      return '<circle class="tr-dot" data-date="' + p.d + '" data-c="' + p.count + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (s ? 4.5 : 3) +
        '" fill="' + (s ? 'var(--accent)' : 'var(--surface)') + '" stroke="' + (s ? 'var(--accent)' : 'var(--steel)') + '" stroke-width="1.6" style="cursor:pointer;"/>';
    }).join('');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '<defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--steel)" stop-opacity="0.25"/><stop offset="100%" stop-color="var(--steel)" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#trendGrad)"/><path d="' + line + '" fill="none" stroke="var(--steel)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' + dots;
    globoEnPuntos(svg, $('trendWrap'), $('trendTip'), '.tr-dot', W, H, (c) => {
      const d = c.getAttribute('data-date')!;
      return fmtDateShort(d) + ' — ' + c.getAttribute('data-c') + ' negados' + (this.radar.isPartialDay(d) ? ' (parcial)' : '');
    });
    svg.querySelectorAll('.tr-dot').forEach((c) => c.addEventListener('click', () => { const d = c.getAttribute('data-date')!; this.elegir(d, d); }));
    tendenciaSobrePuntos(svg, '.tr-dot', (d) => this.radar.isPartialDay(d));
  }

  private renderNegPrepCompare(vm: VistaAgregada) {
    const neg = vm.meta.totalNegados || 0, prep = vm.meta.totalPreparados || 0, total = Math.max(neg + prep, 1), max = Math.max(neg, prep, 1);
    $('negPrepFillNeg').style.width = Math.max(3, neg / max * 100) + '%';
    $('negPrepFillPrep').style.width = Math.max(3, prep / max * 100) + '%';
    $('negPrepValNeg').innerHTML = '<b>' + fmtInt(neg) + '</b>' + fmtPct(neg / total * 100);
    $('negPrepValPrep').innerHTML = '<b>' + fmtInt(prep) + '</b>' + fmtPct(prep / total * 100);
  }

  private renderNegPrepTrend() {
    const svg = $('negPrepTrendSvg') as unknown as SVGSVGElement, dates = this.fechas, W = 900, H = 160, pad = 22;
    const pts0 = dates.map((d) => { const m = this.radar.vistaDia(d).meta; return { date: d, neg: m.totalNegados || 0, prep: m.totalPreparados || 0 }; });
    if (pts0.length < 2) {
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.innerHTML = '<text x="' + W / 2 + '" y="' + (H / 2 + 4) + '" text-anchor="middle" font-size="12" fill="var(--ink-muted)" font-family="var(--font-body)">Sube otro día para ver la tendencia</text>';
      return;
    }
    const max = Math.max(...pts0.map((p) => Math.max(p.neg, p.prep)), 1);
    const xAt = (i: number) => pad + i / (pts0.length - 1) * (W - 2 * pad), yAt = (v: number) => H - pad - (v / max) * (H - 2 * pad - 16);
    const path = (k: 'neg' | 'prep') => pts0.map((p, i) => (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(p[k]).toFixed(1)).join(' ');
    let grid = '';
    for (let g = 0; g <= 2; g++) { const y = pad + g * (H - 2 * pad - 16) / 2; grid += '<line x1="' + pad + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad) + '" y2="' + y.toFixed(1) + '" stroke="var(--border)" stroke-width="1"/>'; }
    const idx = pts0.length <= 8 ? pts0.map((_, i) => i) : [0, Math.round((pts0.length - 1) / 2), pts0.length - 1];
    const labels = idx.map((i) => '<text x="' + xAt(i).toFixed(1) + '" y="' + (H - 4) + '" font-size="9.5" fill="var(--ink-muted)" text-anchor="middle" font-family="var(--font-mono)">' + fmtDateShort(pts0[i].date) + '</text>').join('');
    const dots = (k: 'neg' | 'prep', col: string) => pts0.map((p, i) => '<circle class="np-dot" data-kind="' + k + '" data-date="' + p.date + '" data-v="' + p[k] + '" cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(p[k]).toFixed(1) + '" r="3.4" fill="var(--surface)" stroke="' + col + '" stroke-width="1.8" style="cursor:pointer;"/>').join('');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = grid + '<path d="' + path('prep') + '" fill="none" stroke="var(--good)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<path d="' + path('neg') + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots('neg', 'var(--accent)') + dots('prep', 'var(--good)') + labels;
    globoEnPuntos(svg, $('negPrepTrendWrap'), $('negPrepTrendTip'), '.np-dot', W, H, (c) =>
      fmtDateShort(c.getAttribute('data-date')!) + ' — ' + fmtInt(+c.getAttribute('data-v')!) + ' ' + (c.getAttribute('data-kind') === 'neg' ? 'negados' : 'preparados'));
    tendenciaSobrePuntos(svg, '.np-dot', (d) => this.radar.isPartialDay(d), 'data-kind');
  }

  /* ---------------- preparadores ---------------- */
  private filasFill(): PreparadorVista[] {
    const rows = (this.vm?.fillRateByPreparador || []).slice(), { key, dir } = this.orden;
    return rows.sort((a, b) => {
      let av: string | number = a[key], bv: string | number = b[key];
      if (typeof av === 'string') { av = av.toLowerCase(); bv = String(bv).toLowerCase(); }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  renderFillRateTable() {
    if (!this.vm) return;
    const rows = this.filasFill(), body = $('fillRateBody');
    if (!this.prepSel || !rows.some((r) => r.raw === this.prepSel)) {
      const top = rows.filter((r) => r.negados > 0).sort((a, b) => b.negados - a.negados)[0];
      this.prepSel = top ? top.raw : null;
    }
    const clase = (p: number) => (p >= 95 ? 'good' : p >= 80 ? 'warning' : 'critical');
    body.innerHTML = rows.length ? rows.map((r) => {
      const c = clase(r.fillRate);
      return '<tr data-raw="' + esc(r.raw) + '" title="Ver qué códigos negó"' + (r.raw === this.prepSel ? ' class="sel"' : '') + '>' +
        '<td class="desc">' + esc(r.name) + '</td><td class="count tabular">' + fmtInt(r.solicitado) + '</td><td class="count tabular">' + fmtInt(r.preparados) +
        '</td><td class="count tabular">' + fmtInt(r.negados) + '</td><td><span class="fillrate-val ' + c + '">' + fmtPct(r.fillRate) + '</span>' +
        '<div class="fillrate-bar"><span class="fill ' + c + '" style="width:' + Math.min(100, Math.max(0, r.fillRate)) + '%"></span></div></td></tr>';
    }).join('') : '<tr class="empty-row"><td colspan="5">No hay datos para este día.</td></tr>';
    body.querySelectorAll<HTMLTableRowElement>('tr[data-raw]').forEach((tr) => tr.addEventListener('click', () => {
      this.prepSel = tr.dataset.raw!; this.renderFillRateTable();
    }));
    $('fillRateCount').textContent = rows.length + ' preparador' + (rows.length === 1 ? '' : 'es');
    document.querySelectorAll<HTMLElement>('#fillRateTable thead th').forEach((th) => {
      let a = th.querySelector('.arrow');
      if (this.orden.key === th.dataset.key) {
        if (!a) { a = document.createElement('span'); a.className = 'arrow'; th.appendChild(a); }
        a.textContent = ' ' + (this.orden.dir === 'asc' ? '▲' : '▼');
      } else a?.remove();
    });
    this.renderPreparadorCodes(this.prepSel);
  }

  /** Códigos que negó un preparador en el día o rango elegido. */
  codigosDePreparador(raw: string) {
    const dates = this.radar.diasEnRango(this.desde, this.hasta), map = new Map<string, { sku: string; desc: string; count: number }>();
    let conActividad = 0;
    for (const d of dates) {
      let hit = false;
      for (const p of this.radar.vistaDia(d).pairs || []) {
        if (p.prepRaw !== raw) continue;
        hit = true;
        const e = map.get(p.sku) || { sku: p.sku, desc: p.desc, count: 0 };
        e.count += p.count; map.set(p.sku, e);
      }
      if (hit) conActividad++;
    }
    const list = [...map.values()].sort((a, b) => b.count - a.count);
    return { list, total: list.reduce((s, c) => s + c.count, 0), conActividad, dias: dates.length };
  }

  private renderPreparadorCodes(raw: string | null) {
    const el = $('prepCodeBars'), sub = $('prepCodesSub');
    $('prepCodesLbl').textContent = raw ? 'Códigos que negó ' + parsePreparadorName(raw) : 'Códigos que negó';
    if (!raw) { el.innerHTML = '<div class="history-empty">Sin datos</div>'; sub.textContent = ''; return; }
    const { list, total, conActividad, dias } = this.codigosDePreparador(raw);
    if (!list.length) { el.innerHTML = '<div class="history-empty">Sin datos</div>'; sub.textContent = ''; return; }
    const rango = dias <= 1 ? 'en el día seleccionado' : 'en ' + conActividad + ' de ' + dias + ' días del rango seleccionado';
    sub.textContent = fmtInt(total) + ' negados en ' + list.length + ' código' + (list.length === 1 ? '' : 's') + ' distinto' + (list.length === 1 ? '' : 's') + ' — ' + rango;
    const shown = list.slice(0, 10), max = Math.max(...shown.map((d) => d.count), 1);
    el.innerHTML = shown.map((d) => '<div class="barrow' + (d.count > 1 ? ' repeat' : '') + '"><span class="code">' + esc(d.sku) + '</span>' +
      '<span class="track" title="' + esc(d.desc) + ' — ' + d.count + ' veces"><span class="fill" style="width:' + Math.max(3, d.count / max * 100) + '%"></span></span>' +
      '<span class="num tabular">' + d.count + '</span></div>').join('') +
      (list.length > 10 ? '<div class="history-empty">y ' + fmtInt(list.length - 10) + ' código' + (list.length - 10 === 1 ? '' : 's') + ' más · descarga la tabla para ver el detalle</div>' : '');
  }

  /* ---------------- Excel de negados por preparador ---------------- */
  /** Un solo Excel: fill rate, resumen por preparador y los códigos que negó cada uno (mismo formato que /radar/). */
  excelPreparadores() {
    const vm = this.vm;
    if (!vm) { aviso('err', 'No hay datos cargados todavía.'); return; }
    try {
      const dates = this.radar.diasEnRango(this.desde, this.hasta);
      const titulo = (ws: XLSX.WorkSheet, txt: string, cols: number[]) => {
        XLSX.utils.sheet_add_aoa(ws, [[txt]], { origin: 'A1' });
        ws['!cols'] = cols.map((w) => ({ wch: w }));
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
        return ws;
      };
      const A2 = { origin: 'A2' } as unknown as XLSX.JSON2SheetOpts; // la versión 0.18 acepta origin aunque sus tipos no lo digan
      const wb = XLSX.utils.book_new();
      // fill rate
      const fr = vm.fillRateByPreparador.slice().sort((a, b) => b.solicitado - a.solicitado)
        .map((r) => ({ 'Preparador': r.name, 'Solicitado': r.solicitado, 'Preparado': r.preparados, 'Negado': r.negados, 'Fill rate (%)': Math.round(r.fillRate * 10) / 10 }));
      const fTxt = vm.date ? 'Día: ' + vm.date : 'Rango: ' + vm.rangeFrom + ' a ' + vm.rangeTo + ' (' + vm.rangeDays + ' días)';
      XLSX.utils.book_append_sheet(wb, titulo(XLSX.utils.json_to_sheet(fr.length ? fr : [{ 'Preparador': '', 'Solicitado': '', 'Preparado': '', 'Negado': '', 'Fill rate (%)': '' }], A2), fTxt, [32, 14, 14, 14, 16]), 'Fill rate por preparador');
      // resumen y detalle por preparador
      const raws = new Set<string>(), prepSkus = new Map<string, Set<string>>();
      for (const d of dates) {
        const v = this.radar.vistaDia(d);
        (v.pairs || []).forEach((p) => raws.add(p.prepRaw));
        (v.preparedPairs || []).forEach((p) => { raws.add(p.prepRaw); (prepSkus.get(p.prepRaw) || prepSkus.set(p.prepRaw, new Set()).get(p.prepRaw)!).add(p.sku); });
      }
      const resumen: Record<string, string | number>[] = [], detalle: Record<string, string | number>[] = [];
      raws.forEach((raw) => {
        const parts = String(raw).split(' - '), id = parts.length > 1 ? parts[0].trim() : '', name = parts.length > 1 ? parts.slice(1).join(' - ').trim() : raw;
        const { list, total } = this.codigosDePreparador(raw);
        resumen.push({ 'Código preparador': id, 'Preparador': name, 'Códigos negados (distintos)': list.length, 'Total veces negado': total, 'Códigos preparados (distintos)': (prepSkus.get(raw) || new Set()).size });
        list.forEach((c) => detalle.push({ 'Código preparador': id, 'Preparador': name, 'Código': c.sku, 'Veces negado': c.count }));
      });
      resumen.sort((a, b) => (b['Total veces negado'] as number) - (a['Total veces negado'] as number));
      detalle.sort((a, b) => (a['Preparador'] !== b['Preparador'] ? (a['Preparador'] < b['Preparador'] ? -1 : 1) : (b['Veces negado'] as number) - (a['Veces negado'] as number)));
      const rTxt = dates.length ? (dates.length === 1 ? 'Día: ' + dates[0] : 'Rango: ' + dates[0] + ' a ' + dates[dates.length - 1] + ' (' + dates.length + ' días seleccionados)') : 'Sin días seleccionados';
      XLSX.utils.book_append_sheet(wb, titulo(XLSX.utils.json_to_sheet(resumen.length ? resumen : [{ 'Código preparador': '', 'Preparador': '', 'Códigos negados (distintos)': '', 'Total veces negado': '', 'Códigos preparados (distintos)': '' }], A2), rTxt, [16, 32, 24, 18, 24]), 'Resumen por preparador');
      XLSX.utils.book_append_sheet(wb, titulo(XLSX.utils.json_to_sheet(detalle.length ? detalle : [{ 'Código preparador': '', 'Preparador': '', 'Código': '', 'Veces negado': '' }], A2), rTxt, [16, 32, 14, 14]), 'Detalle códigos negados');
      const suf = vm.date || (vm.rangeFrom ? vm.rangeFrom + '_a_' + vm.rangeTo : 'sin_fecha');
      descargar(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Negados_por_preparador_' + suf + '.xlsx');
      aviso('ok', 'Descargando negados por preparador…');
    } catch (err) { console.error(err); aviso('err', 'No se pudo generar el Excel: ' + ((err as Error)?.message || 'error')); }
  }
}
