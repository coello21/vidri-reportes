/**
 * Lectura del rpt_ListaPreparacionAuditoria (Excel). Mismas reglas que la página original:
 * una orden por fila; se toman las filas con ID, "Preparador: …" y hora del 1° y último código preparado.
 * Además se leen las demás columnas (revisador, unidades, tiempos) para el análisis de picking.
 */
import * as XLSX from 'xlsx';
import { norm } from './listado';

/**
 * Orden para los cálculos (mismo formato que la página original):
 * [id, nombre, items, horas, tipo, día de preparación (fecha del 1er código preparado), zona, t1, t2]
 * t1/t2 = segundos desde 1970 del 1° y último código preparado (null en historial viejo sin hora).
 */
export type Orden = [number, string, number, number, string, string, string, number | null, number | null];

/** Columnas adicionales del reporte (segundos desde 1970 para fechas, minutos para tiempos). */
export interface Extra {
  revisador: string | null; unidades: number | null; fecha_pedido: number | null; asignado: number | null;
  rev1: number | null; rev2: number | null; estado: string | null;
  min_asignacion: number | null; min_preparacion: number | null; min_espera: number | null; min_total: number | null; min_revision: number | null;
}
export interface FilaAuditoria { orden: Orden; extra: Extra }

/** Serial de Excel o fecha → fecha local exacta (evita el desfase de segundos de cellDates). */
export function aFecha(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const u = new Date(Math.round((v - 25569) * 864e5));
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds());
  }
  return v ? new Date(v as string) : null;
}
export const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const seg = (d: Date | null) => (d && !isNaN(d.getTime()) ? Math.round(d.getTime() / 1000) : null);
const num = (v: unknown) => { if (v == null || v === '') return null; const n = Number(v); return isFinite(n) ? n : null; };
const txt = (v: unknown) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return s || null; };

export function leerAuditoria(data: ArrayBuffer | Uint8Array, nombre = 'archivo'): FilaAuditoria[] {
  const wb = XLSX.read(data, { type: 'array' });
  const a = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const h = a.findIndex((r) => r.some((c) => norm(c) === 'TOTAL ITEM'));
  if (h < 0) throw new Error(nombre + ': no encontré la columna TOTAL ITEM (¿es el rpt_ListaPreparacionAuditoria?)');
  const H = a[h].map(norm), ci = (f: (x: string) => boolean) => H.findIndex(f);
  const c = {
    id: ci((x) => x === 'ID'), d: ci((x) => x.startsWith('DESCRIP')), i: ci((x) => x === 'TOTAL ITEM'), t: ci((x) => x.startsWith('TIPO DE PEDIDO')),
    a: ci((x) => x.includes('CODIGO PREPARADO') && !x.includes('ULTIMO')), z: ci((x) => x.includes('CODIGO PREPARADO') && x.includes('ULTIMO')),
    p: ci((x) => x === 'FECHA DE ASIGNACION'),
  };
  if (Object.values(c).includes(-1)) throw new Error(nombre + ': faltan columnas (ID, descripción, tipo de pedido, fecha de asignación o código preparado)');
  const x = {
    zn: ci((v) => v === 'ZONA DE PEDIDO'), rev: ci((v) => v.startsWith('REVISADO POR')), uni: ci((v) => v === 'UNIDADES'), fp: ci((v) => v === 'FECHA PEDIDO'),
    r1: ci((v) => v.includes('CODIGO REVISADO') && !v.includes('ULTIMO')), r2: ci((v) => v.includes('CODIGO REVISADO') && v.includes('ULTIMO')),
    est: ci((v) => v === 'ESTADO'), ta: ci((v) => v === 'TIEMPO ASIGNACION'), tp: ci((v) => v === 'TIEMPO PREPARACION'),
    te: ci((v) => v.startsWith('TIEMPO DE ESPERA')), tt: ci((v) => v === 'TIEMPO TOTAL'), tr: ci((v) => v === 'TIEMPO REVISION'),
  };
  const col = (r: unknown[], i: number) => (i < 0 ? null : r[i]);
  const out: FilaAuditoria[] = [];
  for (const r of a.slice(h + 1)) {
    const id = Number(r[c.id]);
    if (!id || !/Preparador/i.test(String(r[c.d] || ''))) continue;
    const t1 = aFecha(r[c.a]), t2 = aFecha(r[c.z]);
    if (!t1 || !t2 || isNaN(t1.getTime()) || isNaN(t2.getTime())) continue;
    const tp = aFecha(r[c.p]) || t1;
    const n = String(r[c.d]).replace(/^\s*Preparador:\s*/i, '').replace(/\s+/g, ' ').trim();
    const orden: Orden = [id, n, Number(r[c.i]) || 0, +((t2.getTime() - t1.getTime()) / 36e5).toFixed(4), String(r[c.t] ?? ''), ymd(t1),
      x.zn < 0 ? '' : String(r[x.zn] ?? '').replace(/\s+/g, ' ').trim(), Math.round(t1.getTime() / 1000), Math.round(t2.getTime() / 1000)];
    out.push({
      orden,
      extra: {
        revisador: txt(col(r, x.rev)), unidades: num(col(r, x.uni)), fecha_pedido: seg(aFecha(col(r, x.fp))), asignado: seg(tp),
        rev1: seg(aFecha(col(r, x.r1))), rev2: seg(aFecha(col(r, x.r2))), estado: txt(col(r, x.est)),
        min_asignacion: num(col(r, x.ta)), min_preparacion: num(col(r, x.tp)), min_espera: num(col(r, x.te)), min_total: num(col(r, x.tt)), min_revision: num(col(r, x.tr)),
      },
    });
  }
  return out;
}
