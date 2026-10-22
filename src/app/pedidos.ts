/**
 * Pestaña "Pedidos CD" (reporte de transferencias), rehecha en TypeScript con la
 * misma apariencia y reglas que el Radar original. Los cálculos de balance y avance
 * vienen de PedidosCD (src/core), probados contra el tablero original.
 */
import * as XLSX from 'xlsx';
import { PedidosCD, type FiltroBodega, type FilaPorFecha } from '../core/pedidos/cd';
import { MOTIVOS, MOTIVO_NOMBRE, ESTADO_NOMBRE, BODEGA_NOMBRE, bodegaDe, motivoVista, nombreSucursal, type Bodega, type Estado, type MotivoVista, type Pedido } from '../core/pedidos/catalogos';
import { diaDeMin, sumarDiasUTC, diaSemana, DIAS_CORTO, DIAS_LARGO, MESES_CORTO } from '../core/comun/fechas';
import { $, esc, fmtInt, etiquetaDia } from './ui/formato';
import { barrasApiladas, lineas, barras, ranking, nice, corto, tendenciaPct } from './ui/graficos';
import { descargar } from './ui/avisos';

const CAT_C: Record<MotivoVista, string> = { exi: '#3A76B0', b2b: '#DE7A2C', rot: '#4B9A5A', otr: '#9A927F' };
const ST_C = { R: '#DE7A2C', P: '#3A76B0', A: '#4B9A5A' };

/** "19 oct, 4:39 p. m." */
function corteTxt(min: number) {
  const d = new Date(min * 60000);
  let h = d.getUTCHours();
  const ap = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return d.getUTCDate() + ' ' + MESES_CORTO[d.getUTCMonth()] + ', ' + h + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' ' + ap;
}
const dowC = (d: string) => DIAS_CORTO[diaSemana(d)];
const dowL = (d: string) => DIAS_LARGO[diaSemana(d)];

export class PedidosVista {
  bod: FiltroBodega = 'all';
  dia: string | null = null;
  est = new Set<Estado>(['R']);

  constructor(private ped: PedidosCD) { this.conectar(); }

  private conectar() {
    $('pdBod').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.chip'); if (!b) return; this.bod = b.dataset.b as FiltroBodega; this.render(); });
    $('pdDays').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.dch'); if (!b) return; this.dia = this.dia === b.dataset.d ? null : b.dataset.d!; this.render(); });
    $('pdEstSel').addEventListener('change', (e) => {
      const cb = e.target as HTMLInputElement, k = cb.dataset.e as Estado | undefined;
      if (!k) return;
      if (cb.checked) this.est.add(k); else if (this.est.size > 1) this.est.delete(k); else cb.checked = true;
      this.renderTabla();
    });
    let t: number | undefined;
    window.addEventListener('resize', () => { clearTimeout(t); t = window.setTimeout(() => this.render(), 150); });
  }

  /** Vuelve a dibujar si la pestaña está visible. */
  render() {
    if ($('tab-pedidos').hidden) return;
    const ped = this.ped, P = ped.periodo(this.bod), empty = $('pdEmpty'), body = $('pdBody');
    if (!ped.rows.size || !P && this.bod === 'all') {
      empty.hidden = false; body.hidden = true;
      $('pdTitle').textContent = 'Aún no hay datos de pedidos'; $('pdLead').textContent = '';
      return;
    }
    empty.hidden = true; body.hidden = false;
    const bods = (['N', 'B', 'M'] as Bodega[]).filter((b) => [...ped.rows.values()].some((x) => bodegaDe(x) === b));
    $('pdBod').innerHTML = '<button class="chip' + (this.bod === 'all' ? ' on' : '') + '" data-b="all" type="button">Todas</button>' +
      bods.map((b) => '<button class="chip' + (this.bod === b ? ' on' : '') + '" data-b="' + b + '" type="button">' + BODEGA_NOMBRE[b] + '</button>').join('');
    if (!P) { $('pdTitle').textContent = 'Sin pedidos para esta bodega'; return; }

    const lc = ped.ultimoCorte(), cutDay = diaDeMin(lc);
    $('pdCut').textContent = lc ? 'Último corte: ' + corteTxt(lc) : '';
    const D = P.days, n = D.length, di: Record<string, number> = {};
    D.forEach((d, i) => { di[d] = i; });
    const DAY = this.dia && this.dia in di ? this.dia : null, dI = DAY ? di[DAY] : -1;
    const selI = DAY ? [dI] : D.map((_, i) => i);
    this.renderChips(P.all, D, cutDay);
    const part = new Set(D.map((d, i) => (d === cutDay ? i : -1)).filter((i) => i >= 0));
    const z = () => D.map(() => 0);

    // asignación diaria
    const byCat = {} as Record<MotivoVista, number[]>;
    MOTIVOS.forEach((c) => { byCat[c] = z(); });
    const sk = z(), cnt = z(), bod: Partial<Record<Bodega, number[]>> = {};
    P.all.forEach((x) => {
      const d = diaDeMin(x[2]);
      if (!(d in di)) return;
      const i = di[d];
      byCat[motivoVista(x)][i]++; cnt[i]++; sk[i] += x[4];
      const b = bodegaDe(x); (bod[b] || (bod[b] = z()))[i]++;
    });
    const fi = D.map((_, i) => i).filter((i) => !part.has(i)), sum = (a: number[]) => a.reduce((p, q) => p + q, 0), sumS = (a: number[]) => selI.reduce((p, i) => p + (a[i] || 0), 0);
    const tP = sumS(cnt), tS = sumS(sk);
    const pick = (i: number) => { this.dia = this.dia === D[i] ? null : D[i]; this.render(); };
    // gráficos de los últimos 7 días (diseño del 20 oct)
    const k7 = Math.max(0, n - 7), D7 = D.slice(k7), p7 = new Set([...part].map((i) => i - k7).filter((i) => i >= 0));
    barrasApiladas($('pdAsig'), D7, MOTIVOS.filter((c) => sum(byCat[c])).map((c) => ({ name: MOTIVO_NOMBRE[c], color: CAT_C[c], vals: byCat[c].slice(k7) })), { partial: p7, sel: DAY, noTrend: true, onClick: (i) => pick(i + k7) });

    // promedio por día de la semana (días completos con pedidos)
    const dw = [0, 0, 0, 0, 0, 0, 0], dn = [0, 0, 0, 0, 0, 0, 0];
    fi.forEach((i) => { if (!cnt[i]) return; const w = diaSemana(D[i]); dw[w] += cnt[i]; dn[w]++; });
    const avgW = dw.map((v, w) => (dn[w] ? v / dn[w] : 0)), order = [1, 2, 3, 4, 5, 6, 0];
    const act = fi.filter((i) => cnt[i] > 0), avgDay = act.length ? sum(act.map((i) => cnt[i])) / act.length : 0;
    const top2 = order.filter((w) => dn[w]).sort((a, b) => avgW[b] - avgW[a]).slice(0, 2);

    // motivo y bodega con tendencia
    const ser = (a: number[]) => fi.map((i) => a[i]);
    ranking($('pdMot'), MOTIVOS.filter((c) => sumS(byCat[c])).map((c) => ({ l: MOTIVO_NOMBRE[c], v: sumS(byCat[c]), p: tP ? Math.round(sumS(byCat[c]) / tP * 100) : 0, c: CAT_C[c], series: ser(byCat[c]), tr: tendenciaPct(ser(byCat[c])) })).sort((a, b) => b.v - a.v), esc);
    ranking($('pdBodR'), (Object.keys(bod) as Bodega[]).filter((b) => sumS(bod[b]!)).map((b) => ({ l: BODEGA_NOMBRE[b], v: sumS(bod[b]!), p: tP ? Math.round(sumS(bod[b]!) / tP * 100) : 0, series: ser(bod[b]!), tr: tendenciaPct(ser(bod[b]!)), c: b === 'N' ? 'var(--blue)' : 'var(--orange)' })).sort((a, b) => b.v - a.v), esc);

    // pendientes al iniciar cada día
    const arrS = PedidosCD.arrastre(P.all, D), arr = arrS.pedidos;
    const BAL = this.renderBalance(DAY || D[n - 1], pick);
    this.renderPorFecha();
    this.renderAvance(DAY || D[n - 1], D, cutDay, lc, pick);
    this.renderSucursales(P.all.filter((x) => { const d = diaDeMin(x[2]); return DAY ? d === DAY : d in di; }));
    const iLast = DAY ? dI : n - 1, arrHoy = arr[iLast] || 0;

    // tarjetas del balance
    const k = (id: string, v: string, f: string) => { $(id).textContent = v; $(id + 'F').innerHTML = f; };
    if (BAL) {
      const r = BAL, lbl = dowC(r.d) + ' ' + etiquetaDia(r.d), i = di[r.d];
      $('pdK2L').textContent = '+ Entraron el ' + lbl;
      $('pdK4L').textContent = r.cur ? '= Sin terminar ahora' : '= Quedaron sin terminar';
      k('pdK1', fmtInt(r.ini), 'pedidos sin terminar al iniciar el ' + lbl + ' (' + fmtInt(arrS.skus[i] || 0) + ' SKUs)' + (r.sa0 != null ? '<br>de ellos <b>' + fmtInt(r.sa0) + '</b> sin asignar' : ''));
      k('pdK2', fmtInt(r.ent), fmtInt(sk[i] || 0) + ' SKUs' + (r.cur ? ' · día en curso, siguen cayendo' : '') + (avgW[diaSemana(r.d)] && !r.cur ? ' · un ' + dowL(r.d) + ' promedio tiene ' + fmtInt(Math.round(avgW[diaSemana(r.d)])) : ''));
      k('pdK3', fmtInt(r.ter), 'pedidos que pasaron a actualizado ese día' + (r.cur ? ' (hasta el corte)' : ''));
      const bR = ped.pendientes(['R'], this.bod).ok.length, bPp = ped.pendientes(['P'], this.bod).ok.length;
      k('pdK4', fmtInt(r.fin), (r.fin > r.ini ? '▲ ' + fmtInt(r.fin - r.ini) + ' más que al empezar' : r.fin < r.ini ? '▼ ' + fmtInt(r.ini - r.fin) + ' menos que al empezar' : 'igual que al empezar') +
        (r.cur ? ' · al último corte' : '') +
        (r.cur ? '<br><b>' + fmtInt(bR) + '</b> pendientes sin asignar (Recibido) · ' + fmtInt(bPp) + ' en preparación (Procesando)' : r.sa1 != null ? '<br>de ellos <b>' + fmtInt(r.sa1) + '</b> sin asignar' : ''));
    }

    // títulos
    const B = ped.pendientes(['R'], this.bod), bS = B.ok.reduce((a, x) => a + x[4], 0);
    const trT = tendenciaPct(ser(cnt));
    if (DAY) {
      const w = diaSemana(DAY), aw = avgW[w], dd = aw ? (cnt[dI] / aw - 1) * 100 : null;
      $('pdTitle').textContent = 'El ' + DIAS_LARGO[w] + ' ' + etiquetaDia(DAY) + ' se asignaron ' + fmtInt(cnt[dI]) + ' pedidos' +
        (part.has(dI) ? ' (día en curso)' : dd == null || Math.abs(dd) < 5 ? ', lo normal para un ' + DIAS_LARGO[w] : ', ' + Math.round(Math.abs(dd)) + '% ' + (dd > 0 ? 'más' : 'menos') + ' que un ' + DIAS_LARGO[w] + ' promedio');
      const top = MOTIVOS.map((c) => [c, byCat[c][dI]] as [MotivoVista, number]).sort((a, b) => b[1] - a[1])[0];
      $('pdLead').innerHTML = '<b>' + fmtInt(cnt[dI]) + '</b> pedidos y ' + fmtInt(sk[dI]) + ' SKUs' + (this.bod === 'all' ? '' : ' (bodega ' + BODEGA_NOMBRE[this.bod] + ')') + '. El motivo principal fue ' + MOTIVO_NOMBRE[top[0]] + ' (' + fmtInt(top[1]) +
        '). Al iniciar ese día quedaban <b>' + fmtInt(arrHoy) + '</b> pedidos sin terminar de días anteriores. El día va marcado en los gráficos; clic de nuevo en él para volver a hoy.';
    } else {
      $('pdTitle').textContent = 'Se asignan ' + fmtInt(Math.round(avgDay)) + ' pedidos por día' + (top2.length ? '; el ' + DIAS_LARGO[top2[0]] + ' es el pico con ' + fmtInt(Math.round(avgW[top2[0]])) + ' en promedio' + (top2[1] != null ? ' y le sigue el ' + DIAS_LARGO[top2[1]] : '') : '');
      $('pdLead').innerHTML = 'Últimos 15 días, del ' + etiquetaDia(P.from) + ' al ' + etiquetaDia(P.to) + (this.bod === 'all' ? ' (Nejapa, Bazinni y Mobu)' : ' (bodega ' + BODEGA_NOMBRE[this.bod] + ')') + ': <b>' + fmtInt(tP) + '</b> pedidos y ' + fmtInt(tS) +
        ' SKUs. Últimos 7 días contra los 7 anteriores: ' + (trT == null ? 'sin datos suficientes' : Math.abs(trT) < 5 ? 'estable' : trT > 0 ? 'suben ' + Math.round(trT) + '%' : 'bajan ' + Math.round(-trT) + '%') +
        '. Al iniciar el ' + etiquetaDia(D[iLast]) + ' quedaban <b>' + fmtInt(arrHoy) + '</b> pedidos sin terminar del día anterior.';
    }

    // entran vs atendidos
    const ing = z(), ate = z();
    P.all.forEach((x) => { const d = diaDeMin(x[2]); if (d in di) ing[di[d]] += x[4]; if (x[6]) { const a = diaDeMin(x[6]); if (a in di) ate[di[a]] += x[4]; } });
    lineas($('pdFlow'), D7, [{ name: 'Entran', color: '#3A76B0', vals: ing.slice(k7), off: -6 }, { name: 'Atendidos', color: '#DE7A2C', vals: ate.slice(k7), off: 8 }], { partial: p7 });
    const avg = (a: number[]) => { const xs = fi.map((i) => a[i]).filter((v) => v > 0); return xs.length ? sum(xs) / xs.length : 0; };
    $('pdFlowT').textContent = avg(ate) >= avg(ing) ? 'El CD atiende al ritmo de lo que entra' : 'Entra más de lo que el CD atiende';

    // pendiente sin asignar
    const age = (x: Pedido) => (B.lc - (x[7] || x[2])) / 60;
    const AG = [{ l: 'Menos de 24 h', f: (h: number) => h < 24 }, { l: 'De 24 a 48 h', f: (h: number) => h >= 24 && h < 48 }, { l: 'De 48 a 72 h', f: (h: number) => h >= 48 && h < 72 }, { l: 'Más de 72 h', f: (h: number) => h >= 72 }];
    const agS = AG.map((a) => B.ok.filter((x) => a.f(age(x))).reduce((s, x) => s + x[4], 0));
    barras($('pdAge'), AG.map((a, i) => ({ l: a.l, v: agS[i], p: bS ? Math.round(agS[i] / bS * 100) : 0, c: i === 3 ? 'var(--orange)' : 'var(--blue)' })), esc);
    const bc: Partial<Record<MotivoVista, number>> = {};
    B.ok.forEach((x) => { const c = motivoVista(x); bc[c] = (bc[c] || 0) + x[4]; });
    barras($('pdBkType'), MOTIVOS.filter((c) => bc[c]).map((c) => ({ l: MOTIVO_NOMBRE[c], v: bc[c]!, p: bS ? Math.round(bc[c]! / bS * 100) : 0, c: CAT_C[c] })).sort((a, b) => b.v - a.v), esc);
    $('pdPendT').textContent = bS ? 'Quedan ' + fmtInt(bS) + ' SKUs pendientes sin asignar (Recibido); ' + Math.round((bS - agS[0]) / bS * 100) + '% lleva más de 24 horas' : 'No hay pendientes al último corte';
    this.renderTabla();
    const st = B.stale.length;
    $('pdNote').innerHTML = st ? '<b>' + fmtInt(st) + ' pedidos</b> seguían pendientes en una carga anterior pero no vinieron en el último reporte (su fecha quedó fuera del rango exportado). Se omiten de todos los conteos; si vuelven a aparecer en un reporte, se cuentan de nuevo.' : '';
    this.ordenar();
  }

  /** Títulos cortos y balance en cajas como en el reporte ejecutivo (diseño del 20 oct). */
  private ordenar() {
    const T = (id: string, t: string) => { const e = document.getElementById(id); if (e) e.textContent = t; };
    T('pdAsigT', 'Pedidos asignados por día y motivo · últimos 7 días');
    T('pdArrT', 'Balance diario de pedidos');
    T('pdCohT', 'Estado de los pedidos que cayeron ese día');
    T('pdSucT', 'Pedidos por sucursal destino');
    T('pdFlowT', 'SKUs ingresados vs SKUs actualizados');
    document.querySelectorAll<HTMLElement>('#pdFlowT~.leg span').forEach((sp) => { sp.innerHTML = sp.innerHTML.replace('Entran', 'Ingresados').replace('Atendidos', 'Actualizados'); });
    document.querySelectorAll<HTMLElement>('#tab-pedidos .leg i.dash').forEach((i) => { i.parentElement!.style.display = 'none'; });
    const sec = $('pdK1').closest('.kpis');
    if (!sec || !sec.parentNode) return;
    let bx = document.getElementById('pdBal');
    if (!bx) { bx = document.createElement('div'); bx.id = 'pdBal'; bx.className = 'pdbal'; sec.parentNode.insertBefore(bx, sec); }
    sec.classList.add('pdkhide');
    const g = (id: string) => document.getElementById(id)?.textContent || '—';
    const day = g('pdK2L').replace(/^\+\s*Entraron\s*/, '').replace(/^el\s*/, ''), cur = /ahora/i.test(g('pdK4L'));
    bx.innerHTML = '<div><span>Inició</span><b>' + g('pdK1') + '</b><span>sin terminar</span></div><div class="op">+</div>' +
      '<div><span>Entraron</span><b>' + g('pdK2') + '</b><span>' + esc(day) + '</span></div><div class="op">−</div>' +
      '<div><span>Terminados</span><b>' + g('pdK3') + '</b><span>' + esc(day) + '</span></div><div class="op">=</div>' +
      '<div class="fin"><span>' + (cur ? 'Ahora' : 'Quedaron') + '</span><b>' + g('pdK4') + '</b><span>sin terminar</span></div>';
  }

  private renderChips(all: Pedido[], D: string[], cutDay: string) {
    const el = $('pdDays'), c: Record<string, number> = {};
    all.forEach((x) => { const d = diaDeMin(x[2]); c[d] = (c[d] || 0) + 1; });
    const prev = el.scrollLeft;
    el.innerHTML = D.map((d) => {
      const w = diaSemana(d);
      return '<button type="button" class="dch' + (d === this.dia ? ' on' : '') + (w === 1 || w === 2 ? ' pk' : '') + '" data-d="' + d + '"><span class="w">' + DIAS_CORTO[w] + ' ' + etiquetaDia(d) + '</span><b>' + fmtInt(c[d] || 0) + '</b><span class="u">pedidos' + (d === cutDay ? ' · parcial' : '') + '</span></button>';
    }).join('');
    const on = el.querySelector<HTMLElement>('.dch.on');
    if (on) { const r = on.offsetLeft - el.offsetLeft; if (r < prev || r > prev + el.clientWidth - on.offsetWidth) el.scrollLeft = r - el.clientWidth / 2; else el.scrollLeft = prev; }
    else el.scrollLeft = el.scrollWidth;
  }

  /** Tabla del balance diario; devuelve la fila del día elegido. */
  private renderBalance(ref: string, pick: (i: number) => void) {
    const el = $('pdArr'), todas = this.ped.balance(this.bod);
    if (!todas.length) return null;
    // la tabla muestra los últimos 7 días (y el día elegido, si es más viejo); los gráficos siguen con 15
    const rows = todas.filter((x, i) => i >= todas.length - 7 || x.d === ref);
    const r = rows.find((x) => x.d === ref) || rows[rows.length - 1], w = dowL(r.d);
    $('pdArrT').textContent = r.cur ? 'Hoy se empezó con ' + fmtInt(r.ini) + ' pedidos sin terminar; van ' + fmtInt(r.ter) + ' terminados'
      : 'El ' + w + ' ' + etiquetaDia(r.d) + ' quedaron ' + fmtInt(r.fin) + ' pedidos para el día siguiente' + (r.fin > r.ini ? ', ' + fmtInt(r.fin - r.ini) + ' más de los que había al empezar' : r.fin < r.ini ? ', ' + fmtInt(r.ini - r.fin) + ' menos de los que había al empezar' : '');
    el.innerHTML = '<div class="pd-tbl"><table class="bal"><thead><tr><th>Día</th><th>Venían de días anteriores</th><th>+ Entraron ese día</th><th>− Se terminaron</th><th>= Quedaron para el día siguiente</th></tr></thead><tbody>' +
      rows.map((x) => '<tr class="clk' + (x.d === ref ? ' sel' : '') + '" data-i="' + x.i + '"><td>' + dowC(x.d) + ' ' + etiquetaDia(x.d) + (x.cur ? ' <span class="tag">en curso</span>' : '') + '</td><td>' + fmtInt(x.ini) + '</td><td>' + fmtInt(x.ent) + '</td><td>' + fmtInt(x.ter) +
        '</td><td class="' + (x.fin > x.ini ? 'up' : x.fin < x.ini ? 'dn' : '') + '"><b>' + (x.cur ? fmtInt(x.fin) + ' hasta ahora' : fmtInt(x.fin)) + '</b> ' + (x.fin > x.ini ? '▲' : x.fin < x.ini ? '▼' : '') + '</td></tr>').join('') + '</tbody></table></div>';
    el.querySelectorAll<HTMLElement>('tr.clk').forEach((tr) => tr.addEventListener('click', () => pick(+tr.dataset.i!)));
    return r;
  }

  /** Cuadro: con cuántos pedidos empezó hoy cada fecha, cuántos se terminaron y en qué estado siguen. */
  private renderPorFecha() {
    const el = $('pdFech'), R = this.ped.porFecha(this.bod);
    if (!R || !R.filas.length) { el.innerHTML = '<p class="q">Sin pedidos pendientes al último corte.</p>'; return; }
    const F = R.filas, sum = (k: 'inicio' | 'terminados' | 'sinEmpezar' | 'enProceso') => F.reduce((a, f) => a + f[k], 0);
    const nombre = (f: FilaPorFecha) => f.dia == null ? 'Días anteriores' : f.hoy ? 'Hoy, ' + dowC(f.dia) + ' ' + etiquetaDia(f.dia) : dowC(f.dia) + ' ' + etiquetaDia(f.dia);
    const ayer = F.find((f) => f.dia === sumarDiasUTC(R.hoy, -1));
    $('pdFechT').textContent = 'Pendiente de hoy según la fecha del pedido' + (ayer && ayer.sinEmpezar ? ': de ayer siguen ' + fmtInt(ayer.sinEmpezar) + ' sin empezar' : '');
    const fila = (n: string, f: { inicio: number; terminados: number; sinEmpezar: number; enProceso: number }, cls = '') =>
      '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + n + '</td><td>' + fmtInt(f.inicio) + '</td><td>' + fmtInt(f.terminados) + '</td><td' + (f.sinEmpezar ? ' class="up"' : '') + '>' + fmtInt(f.sinEmpezar) +
      '</td><td>' + fmtInt(f.enProceso) + '</td><td><b>' + fmtInt(f.sinEmpezar + f.enProceso) + '</b></td></tr>';
    el.innerHTML = '<div class="pd-tbl"><table class="bal"><thead><tr><th>Fecha del pedido</th><th>Al empezar el día<br><span class="q">(hoy: entraron)</span></th><th>Terminados hoy</th><th>Siguen sin empezar</th><th>Siguen en proceso</th><th>Sin terminar al corte</th></tr></thead><tbody>' +
      F.map((f) => fila(nombre(f), f, f.hoy ? 'sel' : '')).join('') +
      fila('Total', { inicio: sum('inicio'), terminados: sum('terminados'), sinEmpezar: sum('sinEmpezar'), enProceso: sum('enProceso') }, 'tot') + '</tbody></table></div>' +
      '<p class="pd-note">Corte: ' + corteTxt(R.lc) + ' · Días anteriores + hoy = Inició + Entraron del balance; la última columna es el "Sin terminar ahora".</p>';
  }

  /** Estado al último corte de los pedidos que cayeron el día elegido, y su curva de "sin terminar". */
  private renderAvance(ref: string, D: string[], cutDay: string, lc: number, pick: (i: number) => void) {
    const A = this.ped.avance(ref, this.bod), n = A.n;
    const pct = (v: number) => (n ? (v && v / n < 0.01 ? 'menos de 1' : String(Math.round(v / n * 100))) : '0');
    const w = DIAS_CORTO[diaSemana(ref)] + ' ' + etiquetaDia(ref);
    const k = (id: string, v: string, f: string) => { $(id).textContent = v; $(id + 'F').innerHTML = f; };
    $('pdCohT').textContent = n ? 'De los ' + fmtInt(n) + ' pedidos que cayeron el ' + w + ', ' + pct(A.terminados) + '% ya se terminó y ' + pct(A.sinEmpezar) + '% sigue sin empezar' : 'No cayeron pedidos el ' + w;
    $('pdCohQ').textContent = 'Estado al último corte (' + corteTxt(lc) + ') de los pedidos con fecha del ' + w + (ref === cutDay ? ' (día en curso: siguen cayendo pedidos)' : '') + '.';
    k('pdC2', fmtInt(A.sinEmpezar), pct(A.sinEmpezar) + '% · recibidos, nadie los ha empezado');
    k('pdC3', fmtInt(A.enProceso), pct(A.enProceso) + '% · en preparación');
    k('pdC4', fmtInt(A.terminados), pct(A.terminados) + '% · actualizados, preparación terminada');

    // barras por día de llegada
    const all = this.ped.vigentes(this.bod), S = { R: [] as number[], P: [] as number[], A: [] as number[] };
    D.forEach((d) => {
      const c = { R: 0, P: 0, A: 0 };
      all.forEach((x) => { if (diaDeMin(x[2]) !== d) return; const st = x[3] === 'A' ? 'A' : x[3] === 'P' ? 'P' : 'R'; c[st]++; });
      S.R.push(c.R); S.P.push(c.P); S.A.push(c.A);
    });
    barrasApiladas($('pdProg'), D, [{ name: 'Actualizados', color: ST_C.A, vals: S.A }, { name: 'En proceso', color: ST_C.P, vals: S.P }, { name: 'Recibidos sin empezar', color: ST_C.R, vals: S.R }], { sel: ref, noTrend: true, onClick: (i) => pick(D.indexOf(D[i])) });

    // curva de pedidos sin terminar, comparada con el mismo día de la semana anterior
    const el = $('pdBurn'), hs = A.horas, v1 = A.sinTerminar, hp = A.horasSemanaPasada, v0 = A.sinTerminarSemanaPasada, prev = A.prev;
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
    g += line(v0, hp, '#9A927F', true, dowL(prev) + ' ' + etiquetaDia(prev)) + line(v1, hs, '#DE7A2C', false, dowL(ref) + ' ' + etiquetaDia(ref));
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + Ht + '" height="' + Ht + '" role="img">' + g + '</svg>';
    $('pdBurnLeg').innerHTML = '<span><i style="background:#DE7A2C"></i>' + dowL(ref) + ' ' + etiquetaDia(ref) + ' (' + fmtInt(n) + ' pedidos)</span>' +
      (A.nSemanaPasada ? '<span><i class="dash"></i>' + dowL(prev) + ' ' + etiquetaDia(prev) + ' (' + fmtInt(A.nSemanaPasada) + ' pedidos), misma hora</span>' : '');
    const dur = (h: number) => (h < 48 ? Math.round(h) + ' horas' : (h / 24).toFixed(1).replace('.', ',') + ' días');
    if (A.horasParaTerminar != null) {
      $('pdBurnT').textContent = 'Los pedidos del ' + dowL(ref) + ' ' + etiquetaDia(ref) + ' se terminaron en ' + dur(A.horasParaTerminar) + (A.horasParaTerminarSemanaPasada != null ? '; los del ' + dowL(prev) + ' anterior tardaron ' + dur(A.horasParaTerminarSemanaPasada) : '');
      return;
    }
    $('pdBurnT').textContent = A.quedabanSemanaPasada == null || !A.nSemanaPasada
      ? 'Quedan ' + fmtInt(A.quedan) + ' pedidos del ' + dowL(ref) + ' sin terminar'
      : 'Quedan ' + fmtInt(A.quedan) + ' pedidos del ' + dowL(ref) + ' sin terminar; a esta misma altura la semana pasada quedaban ' + fmtInt(A.quedabanSemanaPasada);
  }

  private renderSucursales(rows: Pedido[]) {
    const el = $('pdSucMotT');
    const bods = (['N', 'B', 'M'] as Bodega[]).filter((b) => rows.some((x) => bodegaDe(x) === b)), cats = MOTIVOS.filter((c) => rows.some((x) => motivoVista(x) === c));
    const M: Record<string, Record<string, number>> = {};
    rows.forEach((x) => {
      const s = nombreSucursal(x[1]), r = M[s] || (M[s] = { t: 0, sk: 0 });
      r.t++; r.sk += x[4];
      const c = motivoVista(x); r[c] = (r[c] || 0) + 1;
      const b = 'b' + bodegaDe(x); r[b] = (r[b] || 0) + 1;
    });
    const S = Object.keys(M).sort((a, b) => M[b].t - M[a].t);
    if (!S.length) { el.innerHTML = '<p class="q">Sin pedidos.</p>'; return; }
    const T: Record<string, number> = { t: 0, sk: 0 };
    S.forEach((s) => { for (const k in M[s]) T[k] = (T[k] || 0) + M[s][k]; });
    const cell = (v?: number) => (v ? '<td>' + fmtInt(v) + '</td>' : '<td class="z">·</td>'), mx = Math.max(1, ...S.map((s) => M[s].t));
    $('pdSucT').textContent = S.length > 1 ? S[0] + ' y ' + S[1] + ' concentran el ' + Math.round((M[S[0]].t + M[S[1]].t) / T.t * 100) + '% de los pedidos' + (this.dia ? ' del ' + dowC(this.dia) + ' ' + etiquetaDia(this.dia) : ' de los 15 días') : 'Sucursal destino';
    el.innerHTML = '<table><thead><tr><th>Sucursal destino</th>' + cats.map((c) => '<th>' + MOTIVO_NOMBRE[c] + '</th>').join('') + (bods.length > 1 ? bods.map((b) => '<th>' + BODEGA_NOMBRE[b] + '</th>').join('') : '') + '<th>Pedidos</th><th>SKUs</th></tr></thead><tbody>' +
      S.map((s) => '<tr><td>' + esc(s) + '</td>' + cats.map((c) => cell(M[s][c])).join('') + (bods.length > 1 ? bods.map((b) => cell(M[s]['b' + b])).join('') : '') + '<td class="sb"><span style="width:' + Math.max(2, Math.round(M[s].t / mx * 90)) + 'px"></span><b>' + fmtInt(M[s].t) + '</b></td><td>' + fmtInt(M[s].sk) + '</td></tr>').join('') +
      '<tr class="tot"><td>Total</td>' + cats.map((c) => cell(T[c])).join('') + (bods.length > 1 ? bods.map((b) => cell(T['b' + b])).join('') : '') + '<td>' + fmtInt(T.t) + '</td><td>' + fmtInt(T.sk) + '</td></tr></tbody></table>';
  }

  private datosTabla() {
    const B = this.ped.pendientes(this.est, this.bod), cats = MOTIVOS.filter((c) => B.ok.some((x) => motivoVista(x) === c)), days = [...new Set(B.ok.map((x) => diaDeMin(x[2])))].sort();
    const M = {} as Record<MotivoVista, Record<string, number>>;
    cats.forEach((c) => { M[c] = {}; days.forEach((d) => { M[c][d] = 0; }); });
    B.ok.forEach((x) => { M[motivoVista(x)][diaDeMin(x[2])] += x[4]; });
    return { B, cats, days, M };
  }

  renderTabla() {
    const { B, cats, days, M } = this.datosTabla(), el = $('pdTbl'), lcDay = diaDeMin(B.lc);
    if (!cats.length) { el.innerHTML = '<p class="q">No hay pedidos en los estados elegidos.</p>'; return; }
    const tc: Record<string, number> = {};
    let gt = 0;
    days.forEach((d) => { tc[d] = 0; });
    let h = '<table><thead><tr><th>Motivo</th>' + days.map((d) => '<th>' + etiquetaDia(d) + '</th>').join('') + '<th>Total</th></tr></thead><tbody>';
    cats.forEach((c) => {
      let t = 0;
      h += '<tr><td>' + MOTIVO_NOMBRE[c] + '</td>' + days.map((d) => { const v = M[c][d]; t += v; tc[d] += v; return '<td class="' + (v ? (sumarDiasUTC(lcDay, -2) >= d ? 'old' : '') : 'z') + '">' + (v ? fmtInt(v) : '·') + '</td>'; }).join('') + '<td><b>' + fmtInt(t) + '</b></td></tr>';
      gt += t;
    });
    el.innerHTML = h + '<tr class="tot"><td>Total</td>' + days.map((d) => '<td>' + fmtInt(tc[d]) + '</td>').join('') + '<td>' + fmtInt(gt) + '</td></tr></tbody></table>';
  }

  /** Excel con los SKUs pendientes por motivo y fecha, y el detalle de pedidos. */
  excel() {
    const { B, cats, days, M } = this.datosTabla();
    const aoa: (string | number)[][] = [['Motivo', ...days.map(etiquetaDia), 'Total']], tc = days.map(() => 0);
    cats.forEach((c) => { const r = days.map((d) => M[c][d]); r.forEach((v, i) => { tc[i] += v; }); aoa.push([MOTIVO_NOMBRE[c], ...r, r.reduce((a, b) => a + b, 0)]); });
    aoa.push(['Total', ...tc, tc.reduce((a, b) => a + b, 0)]);
    const f = (min: number) => new Date(min * 60000).toISOString().slice(0, 16).replace('T', ' ');
    const det: (string | number)[][] = [['Número Pedido', 'Sucursal', 'Bodega', 'Fecha', 'Estado', 'SKUs', 'Motivo', 'Recibido', 'Horas pendiente']];
    B.ok.slice().sort((a, b) => a[2] - b[2]).forEach((x) => det.push([x[0], nombreSucursal(x[1]), BODEGA_NOMBRE[bodegaDe(x)], f(x[2]), ESTADO_NOMBRE[x[3]], x[4], MOTIVO_NOMBRE[motivoVista(x)], x[7] ? f(x[7]) : '', Math.round((B.lc - (x[7] || x[2])) / 6) / 10]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'SKUs pendientes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(det), 'Detalle');
    const PF = this.ped.porFecha(this.bod);
    if (PF) {
      const pf: (string | number)[][] = [['Fecha del pedido', 'Al empezar el día (hoy: entraron)', 'Terminados hoy', 'Siguen sin empezar', 'Siguen en proceso', 'Sin terminar al corte']];
      PF.filas.forEach((f) => pf.push([f.dia == null ? 'Días anteriores' : f.dia, f.inicio, f.terminados, f.sinEmpezar, f.enProceso, f.sinEmpezar + f.enProceso]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pf), 'Pendiente por fecha');
    }
    descargar(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Pedidos_pendientes_' + diaDeMin(B.lc) + '.xlsx');
  }
}

