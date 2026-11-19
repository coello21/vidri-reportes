import { timeOf } from '../comun/fechas';
import type { Registro } from './tipos';

/* Deduplicación: mismo Pedido + SKU -> se conserva UNA fila. Si el pedido se reasignó a otra
   orden, se conserva la orden en estado A; si hay varias en A, la de Fecha Actualizado más reciente.
   (Hasta el 19-nov-2026 había un paso 2 por Orden + SKU; se quitó: cada pedido es una línea aunque
   compartan orden.) dedupOrdenSku queda en 0 para no romper el formato guardado. */

const ESTADO_RANK: Record<string, number> = { A: 0, R: 1, P: 2 };
const rankOf = (r: Registro): number => (r.Estado in ESTADO_RANK ? ESTADO_RANK[r.Estado] : 3);

/** true si a es mejor que b */
function preferRow(a: Registro, b: Registro): boolean {
  const ra = rankOf(a), rb = rankOf(b);
  if (ra !== rb) return ra < rb;
  const ta = timeOf(a.FechaAct), tb = timeOf(b.FechaAct);
  if (ta !== tb) return ta > tb;
  return timeOf(a.Fecha) > timeOf(b.Fecha);
}

export interface ResultadoDedup {
  rows: Registro[];
  dedupPedidoSku: number;
  dedupOrdenSku: number;
}

export function dedupRecords(records: Registro[]): ResultadoDedup {
  const best = new Map<string, Registro>();
  for (const r of records) {
    const k = r.Pedido + '|' + r.SKU;
    const cur = best.get(k);
    if (!cur || preferRow(r, cur)) best.set(k, r);
  }
  const rows = Array.from(best.values());
  return { rows, dedupPedidoSku: records.length - rows.length, dedupOrdenSku: 0 };
}
