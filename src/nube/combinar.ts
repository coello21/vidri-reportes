import type { Corte } from '../core/pedidos/cd';
import { ESTADO_RANGO } from '../core/pedidos/catalogos';
import type { FilaPedido } from './filas';

/**
 * Antes de guardar, la página combina lo suyo con lo que hay en la base: otra pestaña o el pipeline
 * pudo guardar algo más nuevo después de que la página se abrió.
 */

/** Gana la versión más avanzada (estado y luego corte, como al integrar un reporte); la hora de asignación es la más temprana. */
export function combinarPedido(pag: FilaPedido, db?: FilaPedido): FilaPedido {
  if (!db) return pag;
  const rp = ESTADO_RANGO[pag.estado] ?? -1, rd = ESTADO_RANGO[db.estado] ?? -1;
  const gana = rp > rd || (rp === rd && pag.corte_min >= db.corte_min) ? pag : db;
  const a = [pag.asignado_min, db.asignado_min].filter((x): x is number => !!x);
  return { ...gana, asignado_min: a.length ? Math.min(...a) : null };
}

export interface MetaPag { cortes: Corte[]; asg: Record<string, number> }

/**
 * Cortes y asignaciones en espera: lo de la página, más lo que otro agregó después de abrirla,
 * menos las asignaciones que otro ya aplicó a su pedido.
 */
export function combinarMeta(pag: MetaPag, orig: MetaPag, ahora: MetaPag | null): MetaPag {
  if (!ahora) return pag;
  const id = (c: Corte) => c.t + '|' + c.cargado;
  const vistos = new Set([...orig.cortes, ...pag.cortes].map(id));
  const cortes = [...pag.cortes, ...ahora.cortes.filter((c) => !vistos.has(id(c)))].sort((a, b) => a.t - b.t).slice(-120);
  const asg = { ...pag.asg };
  for (const k in ahora.asg) if (!(k in orig.asg) && !(k in asg)) asg[k] = ahora.asg[k];
  for (const k in orig.asg) if (!(k in ahora.asg) && asg[k] === orig.asg[k]) delete asg[k];
  return { cortes, asg };
}
