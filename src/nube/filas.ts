import type { Pedido, Estado, Motivo, Bodega } from '../core/pedidos/catalogos';

/** Un pedido tal como está en la tabla `pedidos` de Supabase. */
export interface FilaPedido {
  numero: string;
  origen: string;
  fecha_min: number;
  estado: string;
  skus: number;
  motivo: string | null;
  actualizado_min: number;
  recibido_min: number;
  corte_min: number;
  bodega: string | null;
  asignado_min: number | null;
}

/** "123" -> 123, pero "00123" o "A12" se quedan como texto (igual que la página original). */
export function aNumeroSiAplica(v: unknown): number | string {
  const s = String(v);
  return /^-?\d+$/.test(s) && String(Number(s)) === s ? Number(s) : s;
}

export function aFilaBase(x: Pedido): FilaPedido {
  return {
    numero: String(x[0]),
    origen: String(x[1]),
    fecha_min: x[2] | 0,
    estado: x[3] || 'O',
    skus: x[4] | 0,
    motivo: x[5] == null ? null : x[5],
    actualizado_min: x[6] | 0,
    recibido_min: x[7] | 0,
    corte_min: x[8] | 0,
    bodega: x[9] == null ? null : x[9],
    asignado_min: x[10] ? x[10] | 0 : null,
  };
}

export function aPedido(r: FilaPedido): Pedido {
  const x: Pedido = [
    aNumeroSiAplica(r.numero), aNumeroSiAplica(r.origen), r.fecha_min, r.estado as Estado, r.skus,
    r.motivo as Motivo, r.actualizado_min, r.recibido_min, r.corte_min, r.bodega as Bodega,
  ];
  if (r.asignado_min) x.push(r.asignado_min);
  return x;
}

export const clavePed = (x: Pedido): string => x[0] + '-' + x[1];
