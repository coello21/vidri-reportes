import { ymd, addDays, timeOf } from '../comun/fechas';
import { dedupRecords } from './dedup';
import {
  BIDX, BUCKETS,
  type Bucket, type Dia, type DiaLegacy, type DiaResumen, type Historial, type Registro,
  type ResultadoIntegracion, type StoreRadar,
} from './tipos';

/** Días que se recuerdan las líneas ya contadas y los pendientes. */
export const KEEP_DAYS = 10;
/** Días que se conservan en el histórico. */
export const RETENTION_DAYS = 365;
export const EXACTITUD_META = 99.5;

export const bucketOf = (v: number): Bucket => (v < 0 ? 'negativo' : v === 0 ? 'cero' : 'positivo');

export function parsePreparadorName(raw: string): string {
  const parts = String(raw).split(' - ');
  return parts.length > 1 ? parts.slice(1).join(' - ').trim() : raw;
}

/* ---------- vistas ---------- */
export interface CodigoVista { sku: string; desc: string; cat?: string; bucket: Bucket; count: number }
export interface PreparadorVista { raw: string; name: string; preparados: number; negados: number; solicitado: number; fillRate: number }
export interface VistaDia {
  v: 1 | 2;
  date: string;
  meta: Record<string, any>;
  bucketCounts: Partial<Record<Bucket, number>>;
  codes: CodigoVista[];
  byStore: { name: string; count: number }[];
  storeNames?: string[];
  byHour: { hour: number; count: number }[];
  byPreparador: { raw: string; name: string; count: number }[];
  fillRateByPreparador: PreparadorVista[];
  pairs: { sku: string; desc: string; prepRaw: string; prepName: string; count: number }[];
  preparedPairs: { sku: string; prepRaw: string; count: number }[];
  byCategoria?: { cat: string; total: number; codes: { sku: string; desc: string; count: number }[] }[];
}

export interface VistaAgregada {
  date: string | null;
  rangeFrom: string;
  rangeTo: string;
  rangeDays: number;
  legacyDays: number;
  newDays: number;
  partialDays: number;
  meta: {
    totalOriginal: number; dedupPedidoSku: number; dedupOrdenSku: number;
    totalFinal: number; totalNegados: number; totalPreparados: number;
    pct: number; fecha: string | null; branchCount: number; exactas: number; prepEval: number;
  };
  bucketCounts: Record<Bucket, number>;
  codes: { sku: string; desc: string; bucket: Bucket; count: number }[];
  topCodes: { sku: string; desc: string; count: number }[];
  byStore: { name: string; count: number }[];
  byHour: { hour: number; count: number }[];
  byPreparador: { raw: string; name: string; count: number }[];
  byCategoria: { cat: string; total: number; codes: { sku: string; desc: string; count: number }[] }[];
  fillRateByPreparador: PreparadorVista[];
}

const EMPTY_VIEW: VistaDia = {
  v: 2, date: '', meta: { totalNegados: 0, totalFinal: 0, totalPreparados: 0 }, bucketCounts: {}, codes: [], byStore: [], byHour: [],
  byPreparador: [], fillRateByPreparador: [], pairs: [], preparedPairs: [], byCategoria: [],
};

const esResumen = (d: Dia | undefined): d is DiaResumen => !!d && (d as DiaResumen).v === 2;

/**
 * Estado del Radar de Negados: histórico por día + store (catálogo, pendientes, líneas ya contadas).
 * Misma lógica que el tablero HTML original; aquí sin pantalla, para poder probarla.
 */
export class RadarNegados {
  history: Historial;
  store: StoreRadar;
  private seen: Map<string, Set<string>> | null = null;
  private cache = new Map<string, VistaDia>();

  constructor(history: Historial = {}, store: Partial<StoreRadar> | null = null) {
    this.history = history;
    this.store = (store || {}) as StoreRadar;
    this.ensureStore();
  }

  ensureStore(): void {
    const S = this.store;
    S.skus = S.skus || {};
    S.seen = S.seen || {};
    S.pending = S.pending || {};
    S.covered = S.covered || [];
    S.b2b = S.b2b || {};
    S.backlog = S.backlog || {};
    if (!('legacyCutoff' in S)) {
      const legacy = Object.keys(this.history).filter((d) => (this.history[d] as DiaResumen).v !== 2).sort();
      S.legacyCutoff = legacy.length ? legacy[legacy.length - 1] : null;
    }
  }

  /* ---------- líneas ya contadas ---------- */
  private seenMap(): Map<string, Set<string>> {
    if (this.seen) return this.seen;
    this.seen = new Map();
    for (const d in this.store.seen) this.seen.set(d, new Set(this.store.seen[d] ? this.store.seen[d].split(',') : []));
    return this.seen;
  }
  private isSeen(key: string): boolean {
    for (const s of this.seenMap().values()) if (s.has(key)) return true;
    return false;
  }
  private markSeen(key: string, creDate: string): void {
    const m = this.seenMap();
    if (!m.has(creDate)) m.set(creDate, new Set());
    m.get(creDate)!.add(key);
  }
  persistSeen(): void {
    const m = this.seenMap();
    const dates = Array.from(m.keys()).sort();
    const keepFrom = dates.length ? addDays(dates[dates.length - 1], -KEEP_DAYS) : null;
    this.store.seen = {};
    for (const d of dates) {
      if (keepFrom && d < keepFrom) { m.delete(d); continue; }
      this.store.seen[d] = Array.from(m.get(d)!).join(',');
    }
  }

  /* ---------- estado de los días ---------- */
  isLegacyDay(d: string): boolean { return !!this.history[d] && (this.history[d] as DiaResumen).v !== 2; }
  /** Día con reglas nuevas que todavía no tiene un reporte posterior que lo complete. */
  isPartialDay(d: string): boolean { return esResumen(this.history[d]) && !this.store.covered.includes(d); }
  dias(): string[] { return Object.keys(this.history).sort(); }
  lastCompleteDay(): string | null {
    const dates = this.dias();
    for (let i = dates.length - 1; i >= 0; i--) if (!this.isPartialDay(dates[i])) return dates[i];
    return dates.length ? dates[dates.length - 1] : null;
  }
  limpiarCache(): void { this.cache.clear(); }

  /* ---------- integración de un Excel ---------- */
  private static newDaySummary(d: string): DiaResumen {
    return {
      v: 2, date: d,
      meta: { totalFinal: 0, totalNegados: 0, totalPreparados: 0, exactas: 0 },
      bucket: { positivo: 0, cero: 0, negativo: 0 },
      codes: {}, stores: {}, hours: Array(24).fill(0), preps: {}, pairs: {}, prepSkus: {},
    };
  }

  private addLineToDay(sum: DiaResumen, r: Registro): void {
    const m = sum.meta;
    m.totalFinal++;
    const st = sum.stores[r.Sucursal] || (sum.stores[r.Sucursal] = [0, 0]);
    st[0]++;
    const p = sum.preps[r.Preparador] || (sum.preps[r.Preparador] = [0, 0]);
    if ((r.CantPrep as number) <= 0) {
      m.totalNegados++;
      const b = bucketOf(r.Disponible as number);
      sum.bucket[b]++;
      const c = sum.codes[r.SKU] || (sum.codes[r.SKU] = [0, 0, 0]);
      c[BIDX[b]]++;
      st[1]++;
      p[0]++;
      sum.hours[r.Fin!.getHours()]++;
      const pr = sum.pairs[r.Preparador] || (sum.pairs[r.Preparador] = {});
      pr[r.SKU] = (pr[r.SKU] || 0) + 1;
      const q = sum.qty || (sum.qty = {});
      q[r.SKU] = (q[r.SKU] || 0) + (r.Cantidad || 0);
      this.store.skus[r.SKU] = [r.Desc, r.Categoria, String(r.UM == null ? '' : r.UM).trim()];
    } else {
      m.totalPreparados++;
      // Exactitud de picking: se mandó lo pedido o más (más es normal: caja completa).
      if ((r.CantPrep as number) >= (r.Cantidad as number)) m.exactas++;
      p[1]++;
      const ps = sum.prepSkus[r.Preparador] || (sum.prepSkus[r.Preparador] = {});
      ps[r.SKU] = (ps[r.SKU] || 0) + 1;
    }
  }

  /** Integra las líneas de un Excel. Nunca reemplaza un día: solo suma las líneas que no se habían contado. */
  integrar(records: Registro[]): ResultadoIntegracion {
    this.ensureStore();
    const S = this.store, H = this.history;
    const { rows, dedupPedidoSku, dedupOrdenSku } = dedupRecords(records);
    const cutoff = S.legacyCutoff;
    const res: ResultadoIntegracion = {
      added: 0, addedByDay: {}, already: 0, legacyIgnored: 0, sinDato: 0, otherEstado: 0, pendingNow: 0,
      resolved: 0, dedupPedidoSku, dedupOrdenSku, totalRows: records.length,
    };

    let maxTs = 0;
    records.forEach((r) => { maxTs = Math.max(maxTs, timeOf(r.FechaAct), timeOf(r.Fecha)); });
    const creDates = new Set<string>();
    const b2bPed = new Set(records.filter((r) => /CORPORATIVA/i.test(String(r.Razon || ''))).map((r) => r.Pedido));

    for (const r of rows) {
      const key = r.Pedido + '|' + r.SKU;
      if (!r.Fecha) { res.sinDato++; continue; }
      const creDate = ymd(r.Fecha);
      // Líneas creadas en días de la versión anterior ya están contadas en esos resúmenes.
      if (cutoff && creDate <= cutoff) { res.legacyIgnored++; continue; }
      creDates.add(creDate);

      if (r.Estado === 'A') {
        if (r.CantPrep == null || r.Cantidad == null || r.Disponible == null || !(r.FechaAct || r.FechaRevision)) { res.sinDato++; continue; }
        // Día = Fecha Actualizado; si viene vacía se usa Fecha Enviado Revisión.
        r.Fin = (r.FechaAct || r.FechaRevision) as Date;
        if (this.isSeen(key)) { res.already++; if (S.pending[key]) delete S.pending[key]; continue; }
        const day = ymd(r.Fin);
        if (this.isLegacyDay(day)) { res.legacyIgnored++; continue; }
        if (!H[day]) H[day] = RadarNegados.newDaySummary(day);
        this.addLineToDay(H[day] as DiaResumen, r);
        if (b2bPed.has(r.Pedido)) {
          const b = S.b2b[r.Pedido] || (S.b2b[r.Pedido] = [day, 0, 1]);
          if (day > b[0]) b[0] = day;
          b[1]++;
          if (!((r.CantPrep as number) >= (r.Cantidad as number))) b[2] = 0;
        }
        this.markSeen(key, creDate);
        if (S.pending[key]) { delete S.pending[key]; res.resolved++; }
        res.added++;
        if (!r.FechaAct) res.fechaRespaldo = (res.fechaRespaldo || 0) + 1;
        res.addedByDay[day] = (res.addedByDay[day] || 0) + 1;
      } else if (r.Estado === 'P' || r.Estado === 'R') {
        if (this.isSeen(key)) continue;
        S.pending[key] = [r.Estado, r.Sucursal, r.Preparador, r.SKU, creDate];
      } else {
        res.otherEstado++;
      }
    }

    // Un día de creación queda "completo" cuando se cargó un reporte sacado después de ese día.
    const maxDay = maxTs > 0 ? ymd(new Date(maxTs)) : null;
    creDates.forEach((d) => { if (maxDay && maxDay > d && !S.covered.includes(d)) S.covered.push(d); });
    S.covered.sort();

    // Limpieza: pendientes demasiado viejos.
    const allCre = Object.values(S.pending).map((p) => p[4]).concat(Array.from(creDates)).sort();
    if (allCre.length) {
      const keepFrom = addDays(allCre[allCre.length - 1], -KEEP_DAYS);
      for (const k in S.pending) if (S.pending[k][4] < keepFrom) delete S.pending[k];
    }
    // B2B: los pedidos ya cerrados y viejos se resumen en su día.
    if (maxDay) {
      const pendPed = new Set(Object.keys(S.pending).map((k) => k.split('|')[0]));
      const foldBefore = addDays(maxDay, -KEEP_DAYS);
      for (const p in S.b2b) {
        const b = S.b2b[p];
        const dia = H[b[0]];
        if (b[0] < foldBefore && !pendPed.has(p) && esResumen(dia)) {
          dia.meta.b2bTot = (dia.meta.b2bTot || 0) + 1;
          dia.meta.b2bOk = (dia.meta.b2bOk || 0) + b[2];
          delete S.b2b[p];
        }
      }
    }

    this.persistSeen();
    S.covered = S.covered.filter((d) => H[d] || (maxDay && d >= addDays(maxDay, -KEEP_DAYS)));

    res.pendingNow = Object.keys(S.pending).length;
    S.updatedAt = new Date().toISOString();
    this.cache.clear();
    return res;
  }

  /** Lo que hace el botón "Cargar Excel": integra y quita del histórico los días de más de un año. */
  cargarRegistros(records: Registro[]): ResultadoIntegracion {
    if (!records.length) throw new Error('El archivo no tiene filas de datos reconocibles.');
    const res = this.integrar(records);
    const dates = this.dias();
    const limit = dates.length ? addDays(dates[dates.length - 1], -RETENTION_DAYS) : null;
    const toRemove = limit ? dates.filter((d) => d < limit) : [];
    toRemove.forEach((d) => delete this.history[d]);
    if (toRemove.length) res.recortados = toRemove;
    this.cache.clear();
    return res;
  }

  pendientes(): { total: number; P: number; R: number } {
    const out = { total: 0, P: 0, R: 0 };
    for (const k in this.store.pending) { out.total++; (out as any)[this.store.pending[k][0]]++; }
    return out;
  }

  /* ---------- vista de un día ---------- */
  vistaDia(d: string): VistaDia {
    const rec = this.history[d];
    if (!rec) return EMPTY_VIEW;
    if ((rec as DiaLegacy).v === 1) return this.vistaLegacy(d, rec as DiaLegacy);
    if (!esResumen(rec)) return rec as unknown as VistaDia;
    const cached = this.cache.get(d);
    if (cached) return cached;
    const m = rec.meta;
    const info = (sku: string): [string, string] => {
      const s = this.store.skus[sku];
      return s ? [s[0], s[1] || '(Sin categoría)'] : ['', '(Sin categoría)'];
    };
    const codes: CodigoVista[] = [];
    for (const sku in rec.codes) {
      const arr = rec.codes[sku], inf = info(sku);
      BUCKETS.forEach((b, i) => { if (arr[i]) codes.push({ sku, desc: inf[0], cat: inf[1], bucket: b, count: arr[i] }); });
    }
    codes.sort((a, b) => b.count - a.count);
    const storeNames = Object.keys(rec.stores);
    const byStore = storeNames.filter((n) => rec.stores[n][1] > 0).map((n) => ({ name: n, count: rec.stores[n][1] })).sort((a, b) => b.count - a.count);
    const byHour = rec.hours.map((count, hour) => ({ hour, count }));
    const fillRateByPreparador = this.fillRate(rec.preps);
    const byPreparador = fillRateByPreparador.filter((p) => p.negados > 0).map((p) => ({ raw: p.raw, name: p.name, count: p.negados })).sort((a, b) => b.count - a.count);
    const pairs: VistaDia['pairs'] = [];
    for (const raw in rec.pairs) {
      const nm = parsePreparadorName(raw);
      for (const sku in rec.pairs[raw]) pairs.push({ sku, desc: info(sku)[0], prepRaw: raw, prepName: nm, count: rec.pairs[raw][sku] });
    }
    const preparedPairs: VistaDia['preparedPairs'] = [];
    for (const raw in rec.prepSkus) for (const sku in rec.prepSkus[raw]) preparedPairs.push({ sku, prepRaw: raw, count: rec.prepSkus[raw][sku] });
    const view: VistaDia = {
      v: 2, date: d,
      meta: { ...m, pct: m.totalFinal ? (m.totalNegados / m.totalFinal) * 100 : 0, fecha: d, branchCount: storeNames.length },
      bucketCounts: rec.bucket, codes, byStore, storeNames, byHour, byPreparador, fillRateByPreparador, pairs, preparedPairs,
    };
    this.cache.set(d, view);
    return view;
  }

  private fillRate(preps: Record<string, [number, number]>): PreparadorVista[] {
    return Object.keys(preps).map((raw) => {
      const v = preps[raw], sol = v[0] + v[1];
      return { raw, name: parsePreparadorName(raw), preparados: v[1], negados: v[0], solicitado: sol, fillRate: sol ? (v[1] / sol) * 100 : 0 };
    });
  }

  /** Días de la versión anterior guardados en forma compacta. */
  private vistaLegacy(d: string, rec: DiaLegacy): VistaDia {
    const cached = this.cache.get(d);
    if (cached) return cached;
    const desc = (sku: string) => (this.store.skus[sku] || [''])[0];
    const codes: CodigoVista[] = [];
    for (const sku in rec.codes) {
      const arr = rec.codes[sku];
      BUCKETS.forEach((b, i) => { if (arr[i]) codes.push({ sku, desc: desc(sku), bucket: b, count: arr[i] }); });
    }
    codes.sort((a, b) => b.count - a.count);
    const fillRateByPreparador = this.fillRate(rec.preps);
    const byPreparador = fillRateByPreparador.filter((p) => p.negados > 0).map((p) => ({ raw: p.raw, name: p.name, count: p.negados })).sort((a, b) => b.count - a.count);
    const pairs: VistaDia['pairs'] = [];
    for (const raw in rec.pairs) {
      const nm = parsePreparadorName(raw);
      for (const sku in rec.pairs[raw]) pairs.push({ sku, desc: desc(sku), prepRaw: raw, prepName: nm, count: rec.pairs[raw][sku] });
    }
    const preparedPairs: VistaDia['preparedPairs'] = [];
    for (const raw in rec.prepSkus) for (const sku in rec.prepSkus[raw]) preparedPairs.push({ sku, prepRaw: raw, count: rec.prepSkus[raw][sku] });
    const view: VistaDia = {
      v: 1, date: d, meta: rec.meta, bucketCounts: rec.bucketCounts || {}, codes,
      byStore: (rec.byStore || []).map((s) => ({ name: s[0], count: s[1] })),
      byHour: (rec.hours || []).map((count, hour) => ({ hour, count })),
      byPreparador, fillRateByPreparador, pairs, preparedPairs,
      byCategoria: (rec.cats || []).map((c) => ({ cat: c[0], total: c[1], codes: c[2].map((x) => ({ sku: x[0], desc: desc(x[0]), count: x[1] })) })),
    };
    this.cache.set(d, view);
    return view;
  }

  /* ---------- suma de un rango de días ---------- */
  diasEnRango(from?: string | null, to?: string | null): string[] {
    const dates = this.dias();
    if (!from || !to) return dates;
    return dates.filter((d) => d >= from && d <= to);
  }

  agregado(from?: string | null, to?: string | null): VistaAgregada | null {
    const dates = this.diasEnRango(from, to);
    if (!dates.length) return null;

    let totalOriginal = 0, dedupPedidoSku = 0, dedupOrdenSku = 0, totalFinal = 0, totalNegados = 0, totalPreparados = 0;
    let exactas = 0, prepEval = 0, legacyDays = 0, newDays = 0, partialDays = 0;
    let singleLegacyBranch: number | null = null;
    const bucketCounts: Record<Bucket, number> = { positivo: 0, cero: 0, negativo: 0 };
    const codeMap = new Map<string, { sku: string; desc: string; bucket: Bucket; count: number }>();
    const topMap = new Map<string, { sku: string; desc: string; count: number }>();
    const storeMap = new Map<string, number>(), hourMap = new Map<number, number>();
    const negBy = new Map<string, number>(), prepBy = new Map<string, number>();
    const catTotal = new Map<string, number>(), catSku = new Map<string, Map<string, { sku: string; desc: string; count: number }>>();
    const storeNames = new Set<string>();

    const addCat = (cat: string, sku: string, desc: string, count: number) => {
      if (!catSku.has(cat)) catSku.set(cat, new Map());
      const mm = catSku.get(cat)!;
      if (!mm.has(sku)) mm.set(sku, { sku, desc, count: 0 });
      mm.get(sku)!.count += count;
    };

    for (const d of dates) {
      const rec = this.vistaDia(d);
      const legacy = rec.v !== 2;
      const m = rec.meta || {};
      if (legacy) {
        legacyDays++;
        totalOriginal += m.totalOriginal || 0;
        dedupPedidoSku += m.dedupPedidoSku || 0;
        dedupOrdenSku += m.dedupOrdenSku || 0;
        if (dates.length === 1) singleLegacyBranch = m.branchCount;
      } else {
        newDays++;
        exactas += m.exactas || 0;
        prepEval += m.totalPreparados || 0;
        if (this.isPartialDay(d)) partialDays++;
      }
      totalFinal += m.totalFinal || 0;
      totalNegados += m.totalNegados || 0;
      totalPreparados += m.totalPreparados || 0;

      const bc = rec.bucketCounts || {};
      BUCKETS.forEach((b) => { bucketCounts[b] += bc[b] || 0; });

      (rec.codes || []).forEach((c) => {
        const key = c.sku + '|' + c.bucket;
        if (!codeMap.has(key)) codeMap.set(key, { sku: c.sku, desc: c.desc, bucket: c.bucket, count: 0 });
        codeMap.get(key)!.count += c.count;
        if (!topMap.has(c.sku)) topMap.set(c.sku, { sku: c.sku, desc: c.desc, count: 0 });
        topMap.get(c.sku)!.count += c.count;
      });

      if (legacy) {
        (rec.byCategoria || []).forEach((cat) => {
          catTotal.set(cat.cat, (catTotal.get(cat.cat) || 0) + (cat.total || 0));
          (cat.codes || []).forEach((c) => addCat(cat.cat, c.sku, c.desc, c.count));
        });
      } else {
        (rec.codes || []).forEach((c) => {
          catTotal.set(c.cat as string, (catTotal.get(c.cat as string) || 0) + c.count);
          addCat(c.cat as string, c.sku, c.desc, c.count);
        });
      }

      (rec.byStore || []).forEach((s) => {
        storeMap.set(s.name, (storeMap.get(s.name) || 0) + s.count);
        if (legacy) storeNames.add(s.name);
      });
      if (!legacy) (rec.storeNames || []).forEach((n) => storeNames.add(n));
      (rec.byHour || []).forEach((h) => { hourMap.set(h.hour, (hourMap.get(h.hour) || 0) + h.count); });
      (rec.fillRateByPreparador || []).forEach((p) => {
        negBy.set(p.raw, (negBy.get(p.raw) || 0) + (p.negados || 0));
        prepBy.set(p.raw, (prepBy.get(p.raw) || 0) + (p.preparados || 0));
      });
    }

    const codes = Array.from(codeMap.values()).sort((a, b) => b.count - a.count);
    const topCodes = Array.from(topMap.values()).sort((a, b) => b.count - a.count);
    const byStore = Array.from(storeMap, ([name, count]) => ({ name, count })).filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourMap.get(h) || 0 }));
    const allRaw = new Set([...negBy.keys(), ...prepBy.keys()]);
    const fillRateByPreparador = Array.from(allRaw).map((raw) => {
      const n = negBy.get(raw) || 0, p = prepBy.get(raw) || 0, sol = n + p;
      return { raw, name: parsePreparadorName(raw), preparados: p, negados: n, solicitado: sol, fillRate: sol ? (p / sol) * 100 : 0 };
    }).sort((a, b) => b.solicitado - a.solicitado);
    const byPreparador = fillRateByPreparador.filter((p) => p.negados > 0).map((p) => ({ raw: p.raw, name: p.name, count: p.negados })).sort((a, b) => b.count - a.count);
    const byCategoria = Array.from(catTotal, ([cat, total]) => {
      const list = Array.from((catSku.get(cat) || new Map()).values()).sort((a, b) => b.count - a.count);
      return { cat, total, codes: list.slice(0, 20) };
    }).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);

    const single = dates.length === 1;
    return {
      date: single ? dates[0] : null,
      rangeFrom: dates[0],
      rangeTo: dates[dates.length - 1],
      rangeDays: dates.length,
      legacyDays, newDays, partialDays,
      meta: {
        totalOriginal, dedupPedidoSku, dedupOrdenSku, totalFinal, totalNegados, totalPreparados,
        pct: totalFinal ? (totalNegados / totalFinal) * 100 : 0,
        fecha: single ? dates[0] : null,
        branchCount: singleLegacyBranch != null ? singleLegacyBranch : storeNames.size,
        exactas, prepEval,
      },
      bucketCounts, codes, topCodes, byStore, byHour, byPreparador, byCategoria, fillRateByPreparador,
    };
  }

  /** Exactitud de picking del rango: líneas mandadas completas ÷ líneas preparadas. */
  exactitud(vm: VistaAgregada): number | null {
    return vm.newDays && vm.meta.prepEval ? (vm.meta.exactas / vm.meta.prepEval) * 100 : null;
  }

  /** Fill rate B2B: pedidos corporativos con todas sus líneas completas ÷ pedidos corporativos cerrados. */
  fillRateB2B(from?: string | null, to?: string | null): { tot: number; ok: number; enProceso: number; pct: number | null } {
    const dates = this.diasEnRango(from, to).filter((d) => !this.isLegacyDay(d));
    const set = new Set(dates);
    const pendPed = new Set(Object.keys(this.store.pending || {}).map((k) => k.split('|')[0]));
    let tot = 0, ok = 0, enProceso = 0;
    dates.forEach((d) => {
      const r = this.history[d];
      if (esResumen(r)) { tot += r.meta.b2bTot || 0; ok += r.meta.b2bOk || 0; }
    });
    for (const p in this.store.b2b || {}) {
      const b = this.store.b2b[p];
      if (!set.has(b[0])) continue;
      if (pendPed.has(p)) { enProceso++; continue; }
      tot++; ok += b[2];
    }
    return { tot, ok, enProceso, pct: tot ? (ok / tot) * 100 : null };
  }
}
