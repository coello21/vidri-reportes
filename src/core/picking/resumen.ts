/**
 * Picking: resume el Rpt_OrdenesPreparacion por día de creación, código y ubicación.
 * Usa la misma limpieza de duplicados que el Radar (mismo Pedido + Código; en reasignaciones, la orden en A).
 */
import { dedupRecords } from '../negados/dedup';
import type { Registro } from '../negados/tipos';

export interface FilaPicking {
  dia: string; sku: string; ubicacion: string;
  lineas: number; unidades: number; lineas_prep: number; unid_prep: number;
  neg_proceso: number; neg_sinstock: number; neg_negativo: number; pendientes: number;
  pedidos: number; sucursales: number;
}
export interface Codigo { sku: string; descripcion: string | null; um: string | null; categoria: string | null }

const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const txt = (v: unknown) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return s; };

/** Ubicación principal de la línea: Ubicación 1, o la 2 si la 1 viene vacía. */
export const ubicacionDe = (r: Registro) => txt(r.Ubic1) || txt(r.Ubic2);

export function resumirRpt(records: Registro[]): { dias: string[]; filas: FilaPicking[]; codigos: Codigo[]; lineas: number; corte: number } {
  const { rows } = dedupRecords(records);
  const M = new Map<string, FilaPicking & { _p: Set<string>; _s: Set<string> }>();
  const C = new Map<string, Codigo>();
  let lineas = 0;
  for (const r of rows) {
    const f = r.Fecha instanceof Date && !isNaN(r.Fecha.getTime()) ? r.Fecha : null;
    if (!f || r.SKU == null || String(r.SKU).trim() === '') continue;
    const dia = ymd(f), sku = String(r.SKU).trim(), ubic = ubicacionDe(r), k = dia + '|' + sku + '|' + ubic;
    let x = M.get(k);
    if (!x) M.set(k, (x = { dia, sku, ubicacion: ubic, lineas: 0, unidades: 0, lineas_prep: 0, unid_prep: 0, neg_proceso: 0, neg_sinstock: 0, neg_negativo: 0, pendientes: 0, pedidos: 0, sucursales: 0, _p: new Set(), _s: new Set() }));
    x.lineas++; lineas++;
    x.unidades += typeof r.Cantidad === 'number' ? r.Cantidad : 0;
    x._p.add(String(r.Pedido)); if (r.Sucursal) x._s.add(r.Sucursal);
    if (r.Estado === 'A' && typeof r.CantPrep === 'number') {
      if (r.CantPrep > 0) { x.lineas_prep++; x.unid_prep += r.CantPrep; }
      else { const d = typeof r.Disponible === 'number' ? r.Disponible : 0; if (d > 0) x.neg_proceso++; else if (d === 0) x.neg_sinstock++; else x.neg_negativo++; }
    } else x.pendientes++;
    if (!C.has(sku) || (!C.get(sku)!.descripcion && r.Desc)) C.set(sku, { sku, descripcion: txt(r.Desc) || null, um: txt(r.UM) || null, categoria: txt(r.Categoria) || null });
  }
  const filas = [...M.values()].map(({ _p, _s, ...f }) => ({ ...f, pedidos: _p.size, sucursales: _s.size }));
  // hora de corte del archivo: la fecha más reciente que trae (creación, revisión o actualizado)
  let corte = 0;
  for (const r of records) for (const x of [r.Fecha, r.FechaRevision, r.FechaAct]) if (x instanceof Date && x.getTime() > corte) corte = x.getTime();
  return { dias: [...new Set(filas.map((f) => f.dia))].sort(), filas, codigos: [...C.values()], lineas, corte };
}

export interface ResumenCodigo {
  sku: string; ubicacion: string; ubicaciones: number; lineas: number; unidades: number; lineas_prep: number;
  neg_proceso: number; neg_sinstock: number; neg_negativo: number; dias: number; pedidos: number;
}
export interface FilaAbc extends ResumenCodigo { clase: 'A' | 'B' | 'C'; acumulado: number; descripcion: string; um: string; categoria: string }

/** Clasificación ABC por frecuencia de picking (líneas): A hasta el 80% acumulado, B hasta el 95%, C el resto. */
export function abc(res: ResumenCodigo[], cat: Map<string, Codigo>, cortes = { a: 80, b: 95 }): FilaAbc[] {
  const L = res.slice().sort((x, y) => y.lineas - x.lineas || y.unidades - x.unidades || x.sku.localeCompare(y.sku));
  const total = L.reduce((s, x) => s + x.lineas, 0) || 1;
  let acc = 0;
  return L.map((x) => {
    const antes = acc; acc += x.lineas;
    const clase: 'A' | 'B' | 'C' = antes / total * 100 < cortes.a ? 'A' : antes / total * 100 < cortes.b ? 'B' : 'C';
    const c = cat.get(x.sku);
    return { ...x, clase, acumulado: acc / total * 100, descripcion: c?.descripcion || '', um: c?.um || '', categoria: c?.categoria || '' };
  });
}
