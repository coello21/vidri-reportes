import { normUpper } from '../comun/texto';

/** Un pedido como lo guarda la página:
 *  [0] número · [1] origen (sucursal) · [2] fecha del pedido (min) · [3] estado · [4] SKUs · [5] motivo
 *  [6] actualizado (min, 0 si no) · [7] recibido (min) · [8] último corte que lo trajo (min) · [9] bodega
 *  [10] hora de asignación (min, opcional: cuando se creó la orden de preparación) */
export type Pedido = [
  numero: number | string,
  origen: number | string,
  fecha: number,
  estado: Estado,
  skus: number,
  motivo: Motivo,
  actualizado: number,
  recibido: number,
  corte: number,
  bodega: Bodega,
  asignado?: number,
];

/** A actualizado · P procesando · R recibido · E enviar · O otro */
export type Estado = 'A' | 'P' | 'R' | 'E' | 'O';
export type Motivo = 'exi' | 'b2b' | 'rot' | 'otr' | 'ven' | 'lin';
export type Bodega = 'N' | 'B' | 'M';
export type MotivoVista = 'exi' | 'b2b' | 'rot' | 'otr';

export const BODEGAS: Record<string, Bodega> = { NEJAPA: 'N', BAZINNI: 'B', MOBU: 'M' };
export const BODEGA_NOMBRE: Record<Bodega, string> = { N: 'Nejapa', B: 'Bazinni', M: 'Mobu' };

export const SUCURSALES: Record<number, string> = {
  6: 'CD NEJAPA', 15: 'MERLIOT', 51: 'CENTRO', 52: 'VENEZUELA', 54: 'QUEZALTEPEQUE', 55: 'SOYAPANGO', 56: 'ESCALON',
  58: 'SANTA ANA I', 59: 'EJERCITO', 60: 'SAN MIGUELITO', 61: 'SANTA ANA II', 62: 'CONSTITUCION', 63: 'SONSONATE',
  64: 'SAN BENITO', 65: 'MEJICANOS', 66: 'SAN MIGUEL', 67: 'LOURDES', 69: 'SAN MIGUEL II', 70: 'MAYOREO',
  71: 'USULUTAN BY PASS', 72: 'PILETAS', 73: 'SOYAPANGO II', 100: 'B2B',
};
export const nombreSucursal = (c: number | string): string => SUCURSALES[c as number] || 'Sucursal ' + c;
/** Nombre normalizado de sucursal -> código */
export const CODIGO_SUCURSAL: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const c in SUCURSALES) m[normUpper(SUCURSALES[c])] = +c;
  return m;
})();

export const ESTADOS: Record<string, Estado> = { ACTUALIZADO: 'A', RECIBIDO: 'R', PROCESANDO: 'P', ENVIAR: 'E' };
export const ESTADO_NOMBRE: Record<Estado, string> = { A: 'Actualizado', R: 'Recibido', P: 'Procesando', E: 'Enviar', O: 'Otro' };
/** Orden de avance: un pedido nunca retrocede de estado (salvo que el archivo sea más nuevo). */
export const ESTADO_RANGO: Record<string, number> = { E: 0, R: 1, P: 2, A: 3 };

export const MOTIVOS: MotivoVista[] = ['exi', 'b2b', 'rot', 'otr'];
export const MOTIVO_NOMBRE: Record<MotivoVista, string> = { exi: 'Existencia', b2b: 'B2B', rot: 'Rotación', otr: 'Otros' };

/** Motivo desde la "Razón Pedido" del reporte. */
export function motivoDe(t: unknown): Motivo {
  const T = normUpper(t);
  if (T.includes('VENTA CORPORATIVA')) return 'b2b';
  if (T.includes('EXISTENCIA')) return 'exi';
  if (T.includes('ROTACION')) return 'rot';
  return 'otr';
}
/** Motivo para mostrar (ventas y en línea van en Otros). */
export const motivoVista = (x: Pedido): MotivoVista => (x[5] === 'ven' || x[5] === 'lin' ? 'otr' : x[5]);
export const bodegaDe = (x: Pedido): Bodega => x[9] || 'N';
export const clavePedido = (x: Pedido): string => x[0] + '-' + x[1];

/** Pedidos con fecha de más de 60 días respecto a su corte: datos anómalos del reporte; se omiten. */
export const EDAD_MAXIMA_MIN = 60 * 1440;
export const esViejo = (x: Pedido): boolean => x[2] < (x[8] || 0) - EDAD_MAXIMA_MIN;
