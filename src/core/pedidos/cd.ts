import { diaDeMin, mesDeMin, inicioDia, sumarDiasUTC, diaSemana } from '../comun/fechas';
import {
  ESTADO_RANGO, MOTIVOS, bodegaDe, clavePedido, esViejo, motivoVista, nombreSucursal,
  type Bodega, type Estado, type MotivoVista, type Pedido,
} from './catalogos';

export interface Corte { t: number; ini: number; fin: number; n: number; cargado: string }
export type FiltroBodega = 'all' | Bodega;

/** Días que se muestran en la pestaña de pedidos. */
export const VENTANA_DIAS = 15;

const mediana = (a: number[]): number | null => {
  if (!a.length) return null;
  a = a.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

export interface FilaBalance {
  i: number; d: string; cur: boolean;
  /** venían de días anteriores sin terminar */ ini: number;
  /** entraron ese día */ ent: number;
  /** se terminaron ese día */ ter: number;
  /** quedaron para el día siguiente (o sin terminar al corte, si es el día en curso) */ fin: number;
  /** sin asignar al empezar y al terminar el día (null si no hay horas de asignación suficientes) */
  sa0: number | null; sa1: number | null;
  /** mediana de horas hasta tener preparador y de preparación */
  esp: number | null; eje: number | null; nEsp: number;
}

/** Una fila del cuadro "pendiente por fecha del pedido" (dia = null: días anteriores agrupados). */
export interface FilaPorFecha { dia: string | null; hoy: boolean; inicio: number; terminados: number; sinEmpezar: number; enProceso: number }

/**
 * Pedidos del CD (reporte de transferencias). Misma lógica que la pestaña "Pedidos CD"
 * del tablero original, sin pantalla.
 */
export class PedidosCD {
  rows = new Map<string, Pedido>();
  cortes: Corte[] = [];
  /** horas de asignación que llegaron antes que su pedido: "numero-origen" -> minutos */
  asgP: Record<string, number> = {};
  /** meses que cambiaron en la última carga (para guardar solo eso) */
  touch = new Set<string>();

  constructor(src?: { rows?: Pedido[]; cortes?: Corte[]; asgP?: Record<string, number> } | null) {
    if (!src) return;
    this.asgP = src.asgP || {};
    this.cortes = src.cortes || [];
    (src.rows || []).forEach((x) => { if (!esViejo(x)) this.rows.set(clavePedido(x), x); });
  }

  ultimoCorte(): number { return this.cortes.length ? Math.max(...this.cortes.map((c) => c.t)) : 0; }

  /** Integra un reporte. Un pedido no retrocede de estado salvo que el archivo sea más nuevo. */
  integrar(rows: Pedido[], ahoraIso = new Date().toISOString()): { nuevos: number; cambios: number; corte: number; viejos: number } {
    let corte = 0, fmin = Infinity, fmax = 0;
    rows.forEach((x) => { corte = Math.max(corte, x[2], x[6], x[7]); fmin = Math.min(fmin, x[2]); fmax = Math.max(fmax, x[2]); });
    let nuevos = 0, cambios = 0, viejos = 0;
    for (const x of rows) {
      x[8] = corte;
      const k = clavePedido(x), o = this.rows.get(k);
      const a = (o && o[10]) || this.asgP[k] || 0;
      if (a) { x[10] = a; delete this.asgP[k]; }
      if (esViejo(x)) { viejos++; if (o) { this.rows.delete(k); this.touch.add(mesDeMin(o[2])); } continue; }
      if (!o) { this.rows.set(k, x); this.touch.add(mesDeMin(x[2])); nuevos++; continue; }
      const ro = ESTADO_RANGO[o[3]] ?? -1, rx = ESTADO_RANGO[x[3]] ?? -1;
      if (rx > ro || (rx === ro && x[8] >= o[8])) {
        if (JSON.stringify(o) !== JSON.stringify(x)) {
          this.touch.add(mesDeMin(o[2])); this.touch.add(mesDeMin(x[2]));
          this.rows.set(k, x);
          if (o[3] !== x[3] || o[4] !== x[4]) cambios++;
        }
      }
    }
    if (rows.length) {
      this.cortes.push({ t: corte, ini: fmin, fin: fmax, n: rows.length, cargado: ahoraIso });
      this.cortes.sort((a, b) => a.t - b.t);
      this.cortes = this.cortes.slice(-120);
    }
    // conservar 13 meses
    const lim = mesDeMin(corte - 60 * 24 * 400);
    for (const [k, x] of this.rows) if (mesDeMin(x[2]) < lim) { this.rows.delete(k); this.touch.add(mesDeMin(x[2])); }
    for (const [k, x] of this.rows) if (esViejo(x)) { this.rows.delete(k); this.touch.add(mesDeMin(x[2])); }
    return { nuevos, cambios, corte, viejos };
  }

  /** Registra la hora de asignación (la más temprana) de cada pedido. */
  aplicarAsignacion(M: Map<string, number>): { n: number; a: number; p: number } {
    let a = 0, p = 0;
    for (const [k, t] of M) {
      const x = this.rows.get(k);
      if (x) { if (!x[10] || t < x[10]) { x[10] = t; this.touch.add(mesDeMin(x[2])); a++; } }
      else if (!this.asgP[k] || t < this.asgP[k]) { this.asgP[k] = t; p++; }
    }
    return { n: M.size, a, p };
  }

  /** Quita horas de asignación en espera con más de 30 días. */
  podarAsignaciones(): void {
    const lim = (this.ultimoCorte() || 0) - 30 * 1440;
    for (const k in this.asgP) if (this.asgP[k] < lim) delete this.asgP[k];
  }

  /* ---------------- consultas ---------------- */

  /** Pedidos vigentes: terminados o que vinieron en el último corte. */
  vigentes(bod: FiltroBodega = 'all'): Pedido[] {
    const lc = this.ultimoCorte();
    const a = [...this.rows.values()].filter((x) => x[3] === 'A' || x[8] >= lc);
    return bod === 'all' ? a : a.filter((x) => bodegaDe(x) === bod);
  }

  /** Pendientes en ciertos estados: los del último corte (ok) y los que ya no vinieron (stale). */
  pendientes(estados: Iterable<Estado>, bod: FiltroBodega = 'all'): { lc: number; ok: Pedido[]; stale: Pedido[] } {
    const est = new Set(estados), lc = this.ultimoCorte();
    const rows = [...this.rows.values()].filter((x) => (bod === 'all' || bodegaDe(x) === bod) && est.has(x[3]));
    return { lc, ok: rows.filter((x) => x[8] >= lc), stale: rows.filter((x) => x[8] < lc) };
  }

  /** Ventana de los últimos 15 días. */
  periodo(bod: FiltroBodega = 'all'): { from: string; to: string; days: string[]; firstDay: string; lastDay: string; all: Pedido[] } | null {
    if (!this.rows.size) return null;
    const all = this.vigentes(bod);
    if (!all.length) return null;
    const lastDay = diaDeMin(this.ultimoCorte() || Math.max(...all.map((x) => x[2])));
    const firstDay = diaDeMin(Math.min(...all.map((x) => x[2])));
    let to = lastDay, from = sumarDiasUTC(lastDay, -(VENTANA_DIAS - 1));
    if (from < firstDay) from = firstDay;
    const days: string[] = [];
    for (let d = from; d <= to; d = sumarDiasUTC(d, 1)) days.push(d);
    return { from, to, days, firstDay, lastDay, all };
  }

  /** Sin terminar al empezar cada día: llegó antes y no estaba actualizado. */
  static arrastre(all: Pedido[], D: string[]): { pedidos: number[]; skus: number[] } {
    const pedidos = D.map(() => 0), skus = D.map(() => 0);
    D.forEach((d, i) => {
      const t0 = inicioDia(d);
      all.forEach((x) => { if (x[2] >= t0) return; if (x[6] ? x[6] >= t0 : x[3] !== 'A') { pedidos[i]++; skus[i] += x[4]; } });
    });
    return { pedidos, skus };
  }

  /** Balance diario: venían de antes + entraron − se terminaron = quedaron para el día siguiente. */
  balance(bod: FiltroBodega = 'all'): FilaBalance[] {
    const P = this.periodo(bod);
    if (!P) return [];
    const all = P.all, D = P.days, lc = this.ultimoCorte(), cutDay = diaDeMin(lc);
    const arr = PedidosCD.arrastre(all, D).pedidos;
    const pendAt = (t: number) => { let c = 0; all.forEach((x) => { if (x[2] >= t) return; if (x[6] ? x[6] >= t : x[3] !== 'A') c++; }); return c; };
    const asgOf = (x: Pedido) => x[10] || (x[3] === 'R' || x[3] === 'E' ? Infinity : x[6] || lc);
    const sinAsgAt = (t: number) => {
      let c = 0;
      all.forEach((x) => { if (x[2] >= t) return; if (x[6] && x[6] < t) return; if (!x[6] && x[3] === 'A') return; if (asgOf(x) >= t) c++; });
      return c;
    };
    const cobertura = (a: number, b: number) => {
      const T = all.filter((x) => x[6] && x[6] >= a && x[6] < b);
      return T.length ? T.filter((x) => x[10]).length / T.length : 0;
    };
    const backlogR = this.pendientes(['R'], bod).ok.length;
    return D.map((d, i) => {
      const t0 = inicioDia(d), t1 = t0 + 1440, cur = d === cutDay;
      const ini = arr[i];
      const ent = all.filter((x) => x[2] >= t0 && x[2] < t1).length;
      const fin = cur ? pendAt(lc + 1) : i + 1 < D.length ? arr[i + 1] : pendAt(t1);
      const ter = ini + ent - fin;
      const tEnd = cur ? lc + 1 : t1;
      let sa0: number | null = sinAsgAt(t0);
      let sa1: number | null = cur ? backlogR : sinAsgAt(tEnd);
      const ok0 = cobertura(t0 - 1440, t0) >= 0.8, ok1 = cur ? ok0 : ok0 && cobertura(t0, t1) >= 0.8;
      if (!ok0) sa0 = null;
      if (!ok1 && !cur) sa1 = null;
      const esp: number[] = [], eje: number[] = [];
      all.forEach((x) => {
        if (x[10] && x[10] >= t0 && x[10] < t1) esp.push((x[10] - (x[7] || x[2])) / 60);
        if (x[10] && x[6] && x[6] >= t0 && x[6] < t1) eje.push((x[6] - x[10]) / 60);
      });
      return {
        i, d, cur, ini, ent, ter, fin, sa0, sa1,
        esp: ok1 ? mediana(esp.filter((h) => h >= 0)) : null,
        eje: ok1 ? mediana(eje.filter((h) => h >= 0)) : null,
        nEsp: esp.length,
      };
    });
  }

  /**
   * Pendiente del día del último corte según la fecha del pedido:
   * con cuántos se empezó el día (los de hoy = los que entraron), cuántos ya se terminaron
   * y en qué estado siguen los demás. La suma de "inicio" de días anteriores es la caja "Inició".
   * Los días con más de `diasSueltos` días de antigüedad van juntos en una fila (dia = null).
   */
  porFecha(bod: FiltroBodega = 'all', diasSueltos = 6): { hoy: string; lc: number; filas: FilaPorFecha[] } | null {
    const lc = this.ultimoCorte();
    if (!lc) return null;
    const hoy = diaDeMin(lc), t0 = inicioDia(hoy), limite = sumarDiasUTC(hoy, -diasSueltos);
    const M = new Map<string, FilaPorFecha>();
    for (const x of this.vigentes(bod)) {
      const nuevo = x[2] >= t0;
      const pendiente = x[6] ? x[6] >= t0 : x[3] !== 'A';   // misma regla que el balance
      if (!nuevo && !pendiente) continue;
      const d = diaDeMin(x[2]), k = d < limite ? 'ant' : d;
      let f = M.get(k);
      if (!f) { f = { dia: k === 'ant' ? null : d, hoy: d === hoy, inicio: 0, terminados: 0, sinEmpezar: 0, enProceso: 0 }; M.set(k, f); }
      f.inicio++;
      if (x[3] === 'A') f.terminados++;
      else if (x[3] === 'P') f.enProceso++;
      else f.sinEmpezar++;
    }
    const filas = [...M.values()].sort((a, b) => (b.dia || '') < (a.dia || '') ? -1 : (b.dia || '') > (a.dia || '') ? 1 : 0);
    return { hoy, lc, filas };
  }

  /** Estado al último corte de los pedidos que cayeron un día, y su curva de "sin terminar" hora por hora
   *  comparada con el mismo día de la semana anterior. */
  avance(ref: string, bod: FiltroBodega = 'all') {
    const all = this.vigentes(bod), lc = this.ultimoCorte();
    const coh = (d: string) => all.filter((x) => diaDeMin(x[2]) === d);
    const C = coh(ref);
    const cnt: Record<string, number> = { R: 0, P: 0, A: 0, E: 0, O: 0 };
    let skus = 0;
    C.forEach((x) => { cnt[x[3]] = (cnt[x[3]] || 0) + 1; skus += x[4]; });
    const n = C.length, sinEmpezar = cnt.R + (cnt.E || 0) + (cnt.O || 0);
    const prev = sumarDiasUTC(ref, -7), CP = coh(prev);
    const t0 = inicioDia(ref), t0p = t0 - 7 * 1440;
    const H = Math.min(7 * 24, Math.max(2, Math.floor((lc - t0) / 60)));
    const step = H > 72 ? 4 : 2, hs: number[] = [];
    for (let h = 0; h <= H; h += step) hs.push(h);
    if (hs[hs.length - 1] !== H) hs.push(H);
    const pend = (rows: Pedido[], base: number, h: number) => {
      const t = base + h * 60;
      let c = 0;
      rows.forEach((x) => { if (x[2] <= t && !(x[6] ? x[6] <= t : x[3] === 'A')) c++; });
      return c;
    };
    const v1 = hs.map((h) => pend(C, t0, h));
    const hp = hs.filter((h) => t0p + h * 60 <= lc);
    const v0 = CP.length ? hp.map((h) => pend(CP, t0p, h)) : null;
    const at = (vals: number[], hh: number[], h: number) => { let r: number | null = null; hh.forEach((q, i) => { if (q <= h) r = vals[i]; }); return r; };
    const hNow = hs[hs.length - 1];
    const quedan = v1[v1.length - 1];
    const quedabanSemanaPasada = v0 ? at(v0, hp, hNow) : null;
    const terminadoEn = (vals: number[], hh: number[], tot: number) => {
      if (!tot) return null;
      let pk = 0;
      for (let i = 0; i < vals.length; i++) if (vals[i] > vals[pk]) pk = i;
      for (let i = pk; i < vals.length; i++) if (vals[i] <= Math.max(2, tot * 0.02)) return hh[i];
      return null;
    };
    return {
      ref, prev, n, skus,
      sinEmpezar, enProceso: cnt.P, terminados: cnt.A,
      nSemanaPasada: CP.length,
      horas: hs, sinTerminar: v1, horasSemanaPasada: hp, sinTerminarSemanaPasada: v0,
      quedan, quedabanSemanaPasada,
      horasParaTerminar: terminadoEn(v1, hs, n),
      horasParaTerminarSemanaPasada: v0 ? terminadoEn(v0, hp, CP.length) : null,
    };
  }

  /** SKUs pendientes sin asignar (Recibido) por antigüedad y por motivo. */
  pendienteSinAsignar(bod: FiltroBodega = 'all') {
    const B = this.pendientes(['R'], bod);
    const skus = B.ok.reduce((a, x) => a + x[4], 0);
    const edad = (x: Pedido) => (B.lc - (x[7] || x[2])) / 60;
    const tramos = [
      { l: 'Menos de 24 h', f: (h: number) => h < 24 },
      { l: 'De 24 a 48 h', f: (h: number) => h >= 24 && h < 48 },
      { l: 'De 48 a 72 h', f: (h: number) => h >= 48 && h < 72 },
      { l: 'Más de 72 h', f: (h: number) => h >= 72 },
    ].map((t) => {
      const rows = B.ok.filter((x) => t.f(edad(x)));
      return { etiqueta: t.l, pedidos: rows.length, skus: rows.reduce((s, x) => s + x[4], 0) };
    });
    const porMotivo: Partial<Record<MotivoVista, number>> = {};
    B.ok.forEach((x) => { const c = motivoVista(x); porMotivo[c] = (porMotivo[c] || 0) + x[4]; });
    return { lc: B.lc, pedidos: B.ok.length, skus, tramos, porMotivo, noVinieron: B.stale.length };
  }

  /** Tabla de SKUs pendientes por motivo y fecha del pedido, en los estados elegidos. */
  tablaPendientes(estados: Iterable<Estado> = ['R'], bod: FiltroBodega = 'all') {
    const B = this.pendientes(estados, bod);
    const cats = MOTIVOS.filter((c) => B.ok.some((x) => motivoVista(x) === c));
    const days = [...new Set(B.ok.map((x) => diaDeMin(x[2])))].sort();
    const M: Record<string, Record<string, number>> = {};
    cats.forEach((c) => { M[c] = {}; days.forEach((d) => (M[c][d] = 0)); });
    B.ok.forEach((x) => { M[motivoVista(x)][diaDeMin(x[2])] += x[4]; });
    const totalDia: Record<string, number> = {};
    days.forEach((d) => (totalDia[d] = cats.reduce((s, c) => s + M[c][d], 0)));
    const totalMotivo: Record<string, number> = {};
    cats.forEach((c) => (totalMotivo[c] = days.reduce((s, d) => s + M[c][d], 0)));
    return { cats, days, M, totalDia, totalMotivo, total: Object.values(totalMotivo).reduce((a, b) => a + b, 0) };
  }

  /** Pedidos por sucursal destino, motivo y bodega (de un día o de toda la ventana). */
  sucursales(dia: string | null = null, bod: FiltroBodega = 'all') {
    const P = this.periodo(bod);
    if (!P) return [];
    const di = new Set(P.days);
    const rows = P.all.filter((x) => { const d = diaDeMin(x[2]); return dia ? d === dia : di.has(d); });
    const M: Record<string, { sucursal: string; pedidos: number; skus: number; motivo: Record<string, number>; bodega: Record<string, number> }> = {};
    rows.forEach((x) => {
      const s = nombreSucursal(x[1]);
      const r = M[s] || (M[s] = { sucursal: s, pedidos: 0, skus: 0, motivo: {}, bodega: {} });
      r.pedidos++; r.skus += x[4];
      const c = motivoVista(x); r.motivo[c] = (r.motivo[c] || 0) + 1;
      const b = bodegaDe(x); r.bodega[b] = (r.bodega[b] || 0) + 1;
    });
    return Object.values(M).sort((a, b) => b.pedidos - a.pedidos);
  }

  /** Pedidos asignados por día (fecha del pedido) y motivo, en la ventana. */
  asignadosPorDia(bod: FiltroBodega = 'all') {
    const P = this.periodo(bod);
    if (!P) return null;
    const di: Record<string, number> = {};
    P.days.forEach((d, i) => (di[d] = i));
    const z = () => P.days.map(() => 0);
    const porMotivo: Record<MotivoVista, number[]> = { exi: z(), b2b: z(), rot: z(), otr: z() };
    const pedidos = z(), skus = z();
    P.all.forEach((x) => {
      const d = diaDeMin(x[2]);
      if (!(d in di)) return;
      const i = di[d];
      porMotivo[motivoVista(x)][i]++; pedidos[i]++; skus[i] += x[4];
    });
    const diaSem = P.days.map(diaSemana);
    return { days: P.days, pedidos, skus, porMotivo, diaSemana: diaSem };
  }
}
