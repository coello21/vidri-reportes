/** Formatos de números, fechas y texto (iguales a los del Radar original). */
import { DIAS_CORTO, DIAS_LARGO, MESES_CORTO, diaSemana } from '../../core/comun/fechas';

const NF = new Intl.NumberFormat('es-SV');
export const fmtInt = (n: number): string => NF.format(Math.round(n || 0));
export const fmtPct = (n: number): string => n.toFixed(1).replace('.', ',') + '%';
export const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const normText = (s: unknown): string => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "17-oct" */
export const fmtDateShort = (d: string): string => new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
/** "17 de octubre" sin "de": "17 octubre" según es-SV */
export const fechaLarga = (d: string): string => new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'long' });
/** "17-oct" corto con mes de la lista de la página: "17-oct" */
export const etiquetaDia = (d: string): string => +d.slice(8) + '-' + MESES_CORTO[+d.slice(5, 7) - 1];
/** Días con el cambio en el proceso de revisión: sus fechas salen en rojo en gráficos y tablas. */
export const DIAS_CAMBIO: [string, string] = ['2026-11-12', '2026-11-17'];
export const esDiaCambio = (d: string): boolean => d >= DIAS_CAMBIO[0] && d <= DIAS_CAMBIO[1];
/** ' cb' si el día es de la semana del cambio (para la clase CSS). */
export const cCambio = (d: string): string => (esDiaCambio(d) ? ' cb' : '');
/** <title> para SVG en los días del cambio. */
export const tCambio = (d: string): string => (esDiaCambio(d) ? '<title>Inconveniente por el cambio en la revisión</title>' : '');
export const dowCorto = (d: string): string => DIAS_CORTO[diaSemana(d)];
export const dowLargo = (d: string): string => DIAS_LARGO[diaSemana(d)];
/** "viernes 17-oct" */
export const diaConSemana = (d: string): string => dowLargo(d) + ' ' + etiquetaDia(d);

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('Falta el elemento #' + id);
  return el;
}
