/**
 * Cálculos de Productividad de preparación, iguales a la página original (sin pantalla).
 * Productividad = SKUs ÷ horas de preparación; las horas de órdenes que se traslapan cuentan una sola vez.
 */
import { BASE, GLOBAL, MAX_HORAS, MIN_SEG, categoria, clave, meta, metaZona, semana, zona, type Categoria, type Meta, type Persona } from './listado';
import { ymd, type Orden } from './parseo';

export type Seccion = 'retail' | 'b2b' | 'zon' | 'out';
export type Filtro = 'all' | Categoria;
export const FILTROS: [Filtro, string][] = [['all', 'Todos'], ['exi', 'Existencia'], ['rot', 'Rotación'], ['lin', 'Ventas en línea'], ['ven', 'Ventas'], ['otr', 'Otros']];

/* ---------------- bloques de tiempo ---------------- */
export interface Acum { k: number; hs: number; iv: [number, number][] }
export const acum = (): Acum => ({ k: 0, hs: 0, iv: [] });
export const sumar = (a: Acum, o: Orden) => { a.k += o[2]; if (o[7] != null) a.iv.push([o[7], o[8]!]); else a.hs += o[3]; };
function union(iv: [number, number][]): number {
  if (!iv.length) return 0;
  const v = iv.slice().sort((a, b) => a[0] - b[0]);
  let t = 0, s = v[0][0], e = v[0][1];
  for (let i = 1; i < v.length; i++) { const [a, b] = v[i]; if (a <= e) { if (b > e) e = b; } else { t += e - s; s = a; e = b; } }
  return (t + e - s) / 3600;
}
export const horas = (a: Acum) => a.hs + union(a.iv);

/** Orden válida para medir: más de 1 SKU, con tiempo, al menos 10 s por SKU y no más de 4 h. */
export const valida = (items: number, h: number) => items > 1 && h > 0 && h * 3600 / items >= MIN_SEG && h <= MAX_HORAS;
/** Semáforo: g = en meta, y = hasta la tolerancia por debajo, r = más abajo. */
export const estado = (r: number | null, m: Meta | null | undefined): '' | 'g' | 'y' | 'r' => (m && r != null ? (r >= m.m ? 'g' : r >= m.m - m.t ? 'y' : 'r') : '');
export const estadoBalanceo = (v: number | null) => (v == null ? '' : v <= 10 ? 'g' : v <= 15 ? 'y' : 'r');

export interface Opciones { sec: Seccion; flt: Filtro; d1: string; d2: string; zsel: string; zAll: boolean }

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DI = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const hm = (s: number) => { const d = new Date(s * 1000); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
export const fmt = (n: number | null | undefined, d = 1) => (n == null || isNaN(n) ? '–' : n.toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d }));

export interface Jornada { P: Map<string, { a: number; b: number; k: number; std: number; h?: number; lun?: number }>; n: number; K: number; H: number; S: number; rate: number | null; cap: number | null; long: string[]; det: string[] }
export interface FilaPersona {
  pk: string; cod: number | null; name: string; type: string; baja: boolean; zona: string; zn: number;
  ord: number; t: Acum; bad: number; skus: number; hrs: number; rate: number | null; meta: number | null; st: string;
  j?: Jornada; jr: number | null; cap: number | null;
}

/** Día de la orden = día en que se empezó a preparar (1er código preparado), no el de asignación:
 *  una orden asignada el jueves en la tarde y preparada el viernes cuenta el viernes. */
export const diaDePreparacion = (o: Orden): Orden => {
  if (o[7] == null) return o;
  const d = new Date(o[7] * 1000), dia = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return dia === o[5] ? o : [o[0], o[1], o[2], o[3], o[4], dia, o[6], o[7], o[8]];
};

export class Productividad {
  db = new Map<number, Orden>();
  extra: Persona[] = [];
  idx = new Map<string, Persona>();

  constructor(ordenes: Orden[] = [], extra: Persona[] = []) {
    ordenes.forEach((o) => this.db.set(o[0], diaDePreparacion(o)));
    this.extra = extra.slice();
    this.reconstruir();
  }
  reconstruir() { this.idx.clear(); [...BASE, ...this.extra].forEach((s) => this.idx.set(clave(s[1]), s)); }

  /** Agrega órdenes de un Excel (la más nueva reemplaza). */
  integrar(ordenes: Orden[]): { nuevas: number; actualizadas: number; meses: Set<string> } {
    let nuevas = 0, actualizadas = 0; const meses = new Set<string>();
    for (let o of ordenes) { o = diaDePreparacion(o); if (this.db.has(o[0])) actualizadas++; else nuevas++; meses.add(o[5].slice(0, 7)); this.db.set(o[0], o); }
    return { nuevas, actualizadas, meses };
  }
  dias(): string[] { return [...new Set([...this.db.values()].map((o) => o[5]))].sort(); }

  /** Meta de la sección elegida. */
  metaSeccion(o: Opciones): Meta | undefined {
    return o.sec === 'b2b' ? meta('VENTAS CORPORATIVAS') : o.sec === 'retail' && o.flt === 'ven' ? meta('VENTAS') : o.sec === 'retail' && o.flt === 'lin' ? meta('VENTAS EN LINEA') : GLOBAL;
  }
  /** Meta con la que se mide la capacidad de cada orden (balanceo de carga). */
  private metaOrden(o: Orden): number {
    const c = categoria(o[4]);
    if (c === 'b2b') return meta('VENTAS CORPORATIVAS')!.m;
    if (c === 'lin') return meta('VENTAS EN LINEA')!.m;
    if (c === 'ven') return meta('VENTAS')!.m;
    if (c === 'exi') { const z = zona(o[6]); if (z.l.length === 1) return metaZona(z.k).m; }
    return GLOBAL.m;
  }

  /* ---------------- jornada por persona (día de escaneo) ---------------- */
  /** Jornada = 1er a último código preparado del día, de todas sus órdenes, menos lo que cae entre 12:00 y 13:00. */
  jornadas(d1: string, d2: string): Map<string, Jornada> {
    const J = new Map<string, Jornada['P']>();
    for (const o of this.db.values()) {
      if (o[7] == null) continue;
      const k = clave(o[1]); if (!this.idx.has(k)) continue;
      const day = ymd(new Date(o[7] * 1000)); if ((d1 && day < d1) || (d2 && day > d2)) continue;
      let P = J.get(k); if (!P) J.set(k, (P = new Map()));
      let d = P.get(day); if (!d) P.set(day, (d = { a: o[7], b: o[8]!, k: 0, std: 0 }));
      if (o[7] < d.a) d.a = o[7]; if (o[8]! > d.b) d.b = o[8]!; d.k += o[2]; d.std += o[2] / this.metaOrden(o);
    }
    const R = new Map<string, Jornada>();
    for (const [k, P] of J) {
      let K = 0, H = 0, S = 0, n = 0; const long: string[] = [], det: string[] = [];
      for (const [day, d] of [...P].sort()) {
        const L0 = new Date(day + 'T12:00:00').getTime() / 1000, ov = Math.max(0, Math.min(d.b, L0 + 3600) - Math.max(d.a, L0));
        d.h = (d.b - d.a - ov) / 3600; d.lun = ov / 3600;
        if (d.h <= 0) continue;
        n++; K += d.k; H += d.h; S += d.std;
        if (d.h > 10) long.push(day);
        const p = day.split('-');
        det.push(`${+p[2]} ${MES[+p[1] - 1]}: ${hm(d.a)}–${hm(d.b)}${d.lun > 0 ? ' (−' + fmt(d.lun * 60, 0) + ' min almuerzo)' : ''} = ${fmt(d.h)} h, ${d.k} SKUs`);
      }
      R.set(k, { P, n, K, H, S, rate: H > 0 ? K / H : null, cap: H > 0 ? S / H * 100 : null, long, det });
    }
    return R;
  }
  /** Balanceo de carga: diferencia promedio entre el % de capacidad de cada persona y el del equipo, por día. */
  balanceo(JR: Map<string, Jornada>, grp: string): { val: number; cap: number; pers: number; dias: number } | null {
    const BYD = new Map<string, number[]>();
    for (const [k, r] of JR) {
      const s = this.idx.get(k); if (!s || s[2] !== grp) continue;
      for (const [day, d] of r.P) { if (!(d.h! >= 1)) continue; const v = BYD.get(day) || []; v.push(d.std / d.h! * 100); BYD.set(day, v); }
    }
    const days: { day: string; n: number; m: number; val: number }[] = [];
    for (const [day, v] of BYD) {
      if (v.length < 2) continue;
      const m = v.reduce((a, b) => a + b, 0) / v.length; if (!(m > 0)) continue;
      const mad = v.reduce((a, b) => a + Math.abs(b - m), 0) / v.length;
      days.push({ day, n: v.length, m, val: mad / m * 100 });
    }
    if (!days.length) return null;
    const av = (x: 'val' | 'm' | 'n') => days.reduce((a, d) => a + d[x], 0) / days.length;
    return { val: av('val'), cap: av('m'), pers: Math.round(av('n')), dias: days.length };
  }

  /* ---------------- Retail y B2B ---------------- */
  vistaPersonas(o: Opciones) {
    const zv = o.sec === 'retail' && o.flt === 'exi';
    const A = new Map<string, FilaPersona>(), Z = new Map<string, number>(), PP: Record<string, Acum> = {}, ZS: Record<string, Record<string, Acum>> = {}, ZT: Record<string, Acum> = {};
    let ex1 = 0, bT = 0, bL = 0;
    for (const ord of this.db.values()) {
      const [, n, items, h, tipo, day, zr] = ord, k = clave(n), ct = categoria(tipo);
      if (o.sec === 'b2b' ? ct !== 'b2b' : (ct === 'b2b' || (o.flt !== 'all' && ct !== o.flt))) continue;
      if ((o.d1 && day < o.d1) || (o.d2 && day > o.d2)) continue;
      const s = this.idx.get(k); if (!s) continue;
      const z = zona(zr);
      if (zv) {
        Z.set(z.k, z.n);
        if (valida(items, h)) { const q = ZS[z.k] || (ZS[z.k] = {}), r = q[k] || (q[k] = acum()), t = ZT[k] || (ZT[k] = acum()); sumar(r, ord); sumar(t, ord); }
        if (o.zsel && z.k !== o.zsel) continue;
      }
      if (items <= 1) { ex1++; continue; }
      const kk = k + (zv ? '|' + z.k : '');
      let p = A.get(kk);
      if (!p) A.set(kk, (p = { pk: k, cod: s[0], name: s[1], type: s[2], baja: s[3] !== 'Activo', zona: zv ? z.k : '', zn: zv ? z.n : 0, ord: 0, t: acum(), bad: 0, skus: 0, hrs: 0, rate: null, meta: null, st: '', jr: null, cap: null }));
      if (!(h > 0) || h * 3600 / items < MIN_SEG) { p.bad++; bT++; continue; }
      if (h > MAX_HORAS) { p.bad++; bL++; continue; }
      p.ord++; sumar(p.t, ord); sumar(PP[k] || (PP[k] = acum()), ord);
    }
    const media = (r: number[]) => (r.length ? r.reduce((a, b) => a + b, 0) / r.length : null);
    const prom = (x: Record<string, Acum>) => media(Object.values(x).map((a) => [a.k, horas(a)]).filter((v) => v[1] > 0).map((v) => v[0] / v[1]));
    /** Botones de zona (solo en Existencia): [zona ('' = Todas), promedio de las personas]. */
    const zonas: [string, number | null][] = zv ? [['', prom(ZT)] as [string, number | null]].concat([...Z].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map((x) => [x[0], prom(ZS[x[0]] || {})])) : [];
    const zselValida = !zv || !o.zsel || Z.has(o.zsel);
    const JR = zv ? null : this.jornadas(o.d1, o.d2);
    const mS = this.metaSeccion(o);
    let L = [...A.values()];
    L.forEach((p) => {
      p.skus = p.t.k; p.hrs = horas(p.t); p.rate = p.hrs > 0 ? p.skus / p.hrs : null;
      const m = zv ? metaZona(p.zona) : mS; p.meta = m ? m.m : null; p.st = estado(p.rate, m);
      if (JR) { const j = JR.get(p.pk); p.j = j; p.jr = j ? j.rate : null; p.cap = j ? j.cap : null; }
    });
    const T = L.reduce((s, p) => ({ o: s.o + p.ord, k: s.k + p.skus, h: s.h + p.hrs }), { o: 0, k: 0, h: 0 });
    L = L.filter((p) => p.ord + p.bad > 0);
    const mK = zv ? (o.zsel ? metaZona(o.zsel) : GLOBAL) : mS;
    const rT = T.h ? T.k / T.h : null;
    const pr = Object.values(PP).map((x) => [x.k, horas(x)]).filter((x) => x[1] > 0).map((x) => x[0] / x[1]);
    const avg = pr.length ? pr.reduce((a, b) => a + b, 0) / pr.length : null;
    const grp = o.sec === 'b2b' ? 'B2B' : 'Retail';
    const bal = JR ? this.balanceo(JR, grp) : null;
    /** Personas de la tabla (una por persona) con su productividad total, para elegirlas en el gráfico. */
    const personas = new Map<string, { pk: string; name: string; rate: number | null }>();
    for (const p of L) if (!personas.has(p.pk)) { const q = PP[p.pk], hh = q ? horas(q) : 0; personas.set(p.pk, { pk: p.pk, name: p.name, rate: hh > 0 ? q.k / hh : null }); }
    return { zv, filas: L, T, rT, avg, nPer: pr.length, mK, mS, JR: !!JR, bal, grp, zonas, zselValida, ex1, bT, bL, personas: [...personas.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')) };
  }

  /** Tendencia: últimas 12 semanas o 14 días hasta la fecha final, del total y de las personas elegidas. */
  tendencia(o: Opciones, modo: 'w' | 'd', mK: Meta | undefined, elegidas: string[]) {
    const zv = o.sec === 'retail' && o.flt === 'exi', ds = this.dias(), end = o.d2 || ds[ds.length - 1], keys: string[] = [];
    if (modo === 'w') { for (let i = 11; i >= 0; i--) { const d = new Date(end + 'T12:00:00'); d.setDate(d.getDate() - 7 * i); const w = semana(ymd(d)); if (!keys.includes(w)) keys.push(w); } }
    else { for (let i = 13; i >= 0; i--) { const d = new Date(end + 'T12:00:00'); d.setDate(d.getDate() - i); keys.push(ymd(d)); } }
    const KS = new Set(keys), TP: Record<string, Record<string, Acum>> = {};
    for (const ord of this.db.values()) {
      const [, n, items, h, tipo, day, zr] = ord, ct = categoria(tipo);
      if (o.sec === 'b2b' ? ct !== 'b2b' : (ct === 'b2b' || (o.flt !== 'all' && ct !== o.flt))) continue;
      const b = modo === 'w' ? semana(day) : day; if (!KS.has(b)) continue;
      const k = clave(n); if (!this.idx.has(k)) continue; if (zv && o.zsel && zona(zr).k !== o.zsel) continue;
      if (!valida(items, h)) continue;
      sumar((TP[k] || (TP[k] = {}))[b] || (TP[k][b] = acum()), ord);
    }
    const TT: Record<string, { k: number; h: number }> = {};
    for (const k in TP) for (const b in TP[k]) { const a = TT[b] || (TT[b] = { k: 0, h: 0 }); a.k += TP[k][b].k; a.h += horas(TP[k][b]); }
    const fi = keys.findIndex((b) => TT[b]), ks = modo === 'd' ? keys.filter((b) => TT[b]) : (fi < 0 ? keys : keys.slice(fi));
    const R = (x?: { k: number; h: number }) => (x && x.h ? +(x.k / x.h).toFixed(1) : null);
    const yy = new Set(ks.map((x) => x.slice(0, 4))).size > 1;
    const etiquetas = modo === 'w' ? ks.map((k) => 'Sem ' + (+k.slice(5)) + (yy ? ' ' + k.slice(0, 4) : '')) : ks.map((d) => { const p = d.split('-'); return DI[new Date(d + 'T12:00:00').getDay()] + ' ' + (+p[2]) + ' ' + MES[+p[1] - 1]; });
    const total = ks.map((b) => R(TT[b]));
    const personas = elegidas.map((k) => ({ k, nombre: (this.idx.get(k) || [null, k])[1] as string, datos: ks.map((b) => { const a = (TP[k] || {})[b]; return a ? R({ k: a.k, h: horas(a) }) : null; }) }));
    const p = end.split('-');
    return { etiquetas, total, personas, meta: mK, sub: (modo === 'w' ? 'Últimas 12 semanas' : 'Últimos 14 días') + ' hasta el ' + (+p[2]) + ' ' + MES[+p[1] - 1] + ' ' + p[0] + '. Marca personas en la tabla para compararlas.' };
  }

  /* ---------------- Productividad por zona ---------------- */
  vistaZonas(o: Opciones) {
    const P = new Map<string, { pk: string; cod: number | null; name: string; type: string; baja: boolean; z: Record<string, Acum & { o: number; h?: number }>; t: Acum; k?: number; h?: number }>(), ZN = new Map<string, number>();
    let multi = 0;
    for (const ord of this.db.values()) {
      const [, n, items, h, tipo, day, zr] = ord;
      if ((!o.zAll && categoria(tipo) !== 'exi') || (o.d1 && day < o.d1) || (o.d2 && day > o.d2)) continue;
      const k = clave(n), s = this.idx.get(k); if (!s) continue;
      const z0 = zona(zr), z = z0.l.length > 1 ? { k: 'Varias zonas', n: 999, l: z0.l } : z0;
      if (!valida(items, h)) continue;
      if (z0.l.length > 1) multi++;
      ZN.set(z.k, z.n);
      let p = P.get(k); if (!p) P.set(k, (p = { pk: k, cod: s[0], name: s[1], type: s[2], baja: s[3] !== 'Activo', z: {}, t: acum() }));
      const c = p.z[z.k] || (p.z[z.k] = Object.assign(acum(), { o: 0 })); sumar(c, ord); c.o++;
      if (z.n !== 999) sumar(p.t, ord);
    }
    for (const p of P.values()) { p.k = p.t.k; p.h = horas(p.t); for (const c of Object.values(p.z)) c.h = horas(c); }
    const zs = [...ZN].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map((x) => x[0]);
    const zs1 = zs.filter((z) => z !== 'Varias zonas');
    const media = (r: number[]) => (r.length ? r.reduce((a, b) => a + b, 0) / r.length : null);
    const S = zs1.map((z) => {
      let n = 0, k = 0, h = 0; const r: number[] = [];
      for (const p of P.values()) { const c = p.z[z]; if (c) { n += c.o; k += c.k; h += c.h!; if (c.h! > 0) r.push(c.k / c.h!); } }
      const mt = metaZona(z), avg = media(r), tot = h ? k / h : null;
      return { z, n: r.length, o: n, k, h, tot, avg, mt, sa: estado(avg, mt), sg: estado(tot, mt) };
    });
    const L = [...P.values()];
    const tk = L.reduce((a, p) => a + p.k!, 0), th = L.reduce((a, p) => a + p.h!, 0);
    const rZ = th ? tk / th : null, aZ = media(L.filter((p) => p.h! > 0).map((p) => p.k! / p.h!)), nP = L.filter((p) => p.h! > 0).length;
    return { personas: L, zs, zs1, S, tk, th, rZ, aZ, nP, multi, ordenes: S.reduce((a, x) => a + x.o, 0) };
  }

  /* ---------------- Fuera del listado ---------------- */
  vistaFuera(o: Opciones) {
    const O = new Map<string, { name: string; ord: number; v: number; t: Acum; a: string; b: string }>();
    for (const ord of this.db.values()) {
      const [, n, items, h, , day] = ord, k = clave(n);
      if (this.idx.has(k) || (o.d1 && day < o.d1) || (o.d2 && day > o.d2)) continue;
      let p = O.get(k); if (!p) O.set(k, (p = { name: n, ord: 0, v: 0, t: acum(), a: day, b: day }));
      p.ord++; if (day < p.a) p.a = day; if (day > p.b) p.b = day;
      if (valida(items, h)) { p.v++; sumar(p.t, ord); }
    }
    return [...O.values()].map((p) => { const hh = horas(p.t); return { ...p, skus: p.t.k, hrs: hh, rate: hh > 0 ? p.t.k / hh : null }; });
  }
}
