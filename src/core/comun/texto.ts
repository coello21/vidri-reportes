/** Utilidades de texto y números compartidas por todos los reportes. */

/** Minúsculas, sin tildes y sin nada que no sea letra o número ("Fecha Creación" → "fechacreacion"). */
export function normKey(s: unknown): string {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

/** Minúsculas y sin tildes. */
export function normText(s: unknown): string {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Mayúsculas, sin tildes y sin espacios a los lados ("Número Pedido" → "NUMERO PEDIDO"). */
export function normUpper(t: unknown): string {
  return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

/** Número o null. Acepta "1,234.5". */
export function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** Texto recortado; si queda vacío, el valor por defecto. */
export function cleanText(v: unknown, fallback: string): string {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? fallback : s;
}

/** Número si el texto es un entero "limpio" (como lo hace el reporte del ERP); si no, el texto. */
export function numOTexto(v: unknown): number | string {
  return Number(v) || String(v).trim();
}

export const fmtInt = (n: number): string => new Intl.NumberFormat('es-SV').format(Math.round(n));
export const fmtPct = (n: number): string => n.toFixed(1).replace('.', ',') + '%';
