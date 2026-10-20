import { timeOf } from '../comun/fechas';
import type { Registro } from './tipos';

/* Deduplicación
   Paso 1 — mismo Pedido + SKU: se conserva UNA fila. Si el pedido se reasignó a otra
   orden, se conserva la orden en estado A; si hay varias en A, la de Fecha Actualizado
   más reciente.
   Paso 2 — misma Orden + SKU: solo se descarta cuando Cantidad, Cantidad Preparada y
   Disponible son idénticos (una orden puede consolidar varios pedidos). */

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

function pedidoLess(a: string, b: string): boolean {
  const na = Number(a), nb = Number(b);
  if (isFinite(na) && isFinite(nb) && na !== nb) return na < nb;
  return a < b;
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
  const afterPass1 = Array.from(best.values());
  const groups = new Map<string, Registro[]>();
  for (const r of afterPass1) {
    const k = r.Orden + '|' + r.SKU;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(r);
  }
  const drop = new Set<Registro>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const ref = g[0];
    if (!g.every((r) => r.Cantidad === ref.Cantidad && r.CantPrep === ref.CantPrep && r.Disponible === ref.Disponible)) continue;
    const keep = g.reduce((a, b) => (rankOf(b) < rankOf(a) || (rankOf(b) === rankOf(a) && pedidoLess(b.Pedido, a.Pedido)) ? b : a));
    g.forEach((r) => { if (r !== keep) drop.add(r); });
  }
  return {
    rows: afterPass1.filter((r) => !drop.has(r)),
    dedupPedidoSku: records.length - afterPass1.length,
    dedupOrdenSku: drop.size,
  };
}
