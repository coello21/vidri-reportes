import * as XLSX from 'xlsx';

/** Fecha local "aaaa-mm-dd". */
export function ymd(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Suma días a "aaaa-mm-dd" (hora local). */
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Fecha desde una celda de Excel (Date, número de serie o texto "dd/mm/aaaa hh:mm" o ISO). */
export function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? new Date(d.y, d.m - 1, d.d, d.H, d.M, Math.floor(d.S)) : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export const timeOf = (d: Date | null | undefined): number => (d ? d.getTime() : -1);

/* ---------- "minutos locales": hora de El Salvador guardada como si fuera UTC ----------
   Así guardan los pedidos sus fechas; permite sumar y comparar sin problemas de zona horaria. */

/** Minutos locales desde una celda de Excel. 0 si no hay fecha válida (o es 1900). */
export function aMinutos(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') { if (v < 2) return 0; return Math.round((v - 25569) * 1440); }
  if (v instanceof Date) {
    if (v.getFullYear() <= 1900) return 0;
    return Math.round(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes()) / 60000);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/);
  if (m) { if (+m[3] <= 1900) return 0; return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) / 60000; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) { if (+m[1] <= 1900) return 0; return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) / 60000; }
  return 0;
}

/** "aaaa-mm-dd" de unos minutos locales. */
export const diaDeMin = (min: number): string => new Date(min * 60000).toISOString().slice(0, 10);
/** "aaaa-mm" de unos minutos locales. */
export const mesDeMin = (min: number): string => new Date(min * 60000).toISOString().slice(0, 7);
/** Minutos locales al empezar el día "aaaa-mm-dd". */
export const inicioDia = (d: string): number => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 60000;
/** Suma días a "aaaa-mm-dd" sin depender de la zona horaria. */
export function sumarDiasUTC(d: string, n: number): string {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
/** Día de la semana (0 = domingo) de "aaaa-mm-dd". */
export const diaSemana = (d: string): number => new Date(d + 'T00:00:00Z').getUTCDay();

export const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** "19-oct" */
export const etiquetaDia = (d: string): string => +d.slice(8) + '-' + MESES_CORTO[+d.slice(5, 7) - 1];
