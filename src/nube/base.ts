import type { SupabaseClient } from '@supabase/supabase-js';
import type { Dia, StoreRadar } from '../core/negados/tipos';
import type { Corte } from '../core/pedidos/cd';
import type { FilaPedido } from './filas';

export interface Meta { cortes: Corte[]; asg_pend: Record<string, number> }
export type Progreso = (etiqueta: string, pct: number) => void;

/**
 * Lo que la aplicación necesita de la base. Hay una versión con Supabase (abajo)
 * y otra en memoria para las pruebas.
 */
export interface BaseDatos {
  leerDias(desde: string, progreso?: Progreso): Promise<{ fecha: string; data: Dia }[]>;
  leerStore(): Promise<Partial<StoreRadar> | null>;
  leerPedidos(desdeMin: number, progreso?: Progreso): Promise<FilaPedido[]>;
  leerMeta(): Promise<Meta | null>;
  guardarDias(filas: { fecha: string; data: Dia }[]): Promise<void>;
  borrarDias(fechas: string[]): Promise<void>;
  guardarPedidos(filas: FilaPedido[]): Promise<void>;
  guardarStore(data: unknown): Promise<void>;
  guardarMeta(meta: Meta): Promise<void>;
  registrarCarga(origen: string, detalle: unknown): Promise<void>;
}

function revisar<T extends { error: { message?: string; code?: string } | null }>(r: T, que: string): T {
  if (r && r.error) throw new Error(que + ': ' + (r.error.message || r.error.code || 'error'));
  return r;
}

export function trozos<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function enParalelo<T>(tareas: (() => Promise<T>)[], limite: number): Promise<T[]> {
  const res: T[] = new Array(tareas.length);
  let i = 0;
  const obrero = async () => { while (i < tareas.length) { const k = i++; res[k] = await tareas[k](); } };
  await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, obrero));
  return res;
}

export class BaseSupabase implements BaseDatos {
  constructor(private sb: SupabaseClient) {}

  /** Lee una consulta grande en páginas, varias a la vez. */
  private async paginado<R>(tabla: string, columnas: string, filtro: { col: string; desde: string | number },
    orden: string[], tam: number, etiqueta: string, progreso?: Progreso): Promise<R[]> {
    const c = revisar(await this.sb.from(tabla).select(orden[0], { count: 'exact', head: true }).gte(filtro.col, filtro.desde), etiqueta);
    const paginas = Math.max(1, Math.ceil((c.count || 0) / tam));
    let hechas = 0;
    const tareas = Array.from({ length: paginas }, (_, p) => async () => {
      let q = this.sb.from(tabla).select(columnas).gte(filtro.col, filtro.desde);
      for (const o of orden) q = q.order(o);
      const r = revisar(await q.range(p * tam, p * tam + tam - 1), etiqueta);
      hechas++;
      progreso?.(etiqueta, Math.round(hechas / paginas * 100));
      return (r.data || []) as unknown as R[];
    });
    return (await enParalelo(tareas, 6)).flat();
  }

  leerDias(desde: string, progreso?: Progreso) {
    return this.paginado<{ fecha: string; data: Dia }>('radar_dias', 'fecha,data', { col: 'fecha', desde }, ['fecha'], 10, 'Negados por día', progreso);
  }
  async leerStore() {
    const r = revisar(await this.sb.from('radar_store').select('data').eq('id', 1).maybeSingle(), 'Catálogo');
    return r.data ? (r.data as { data: Partial<StoreRadar> }).data : null;
  }
  leerPedidos(desdeMin: number, progreso?: Progreso) {
    return this.paginado<FilaPedido>('pedidos', '*', { col: 'fecha_min', desde: desdeMin }, ['numero', 'origen'], 1000, 'Pedidos', progreso);
  }
  async leerMeta() {
    const r = revisar(await this.sb.from('pedidos_meta').select('cortes,asg_pend').eq('id', 1).maybeSingle(), 'Cortes');
    return (r.data as Meta | null) || null;
  }
  async guardarDias(filas: { fecha: string; data: Dia }[]) {
    await enParalelo(trozos(filas, 5).map((t) => async () => { revisar(await this.sb.from('radar_dias').upsert(t, { onConflict: 'fecha' }), 'Guardar negados'); }), 4);
  }
  async borrarDias(fechas: string[]) {
    if (fechas.length) revisar(await this.sb.from('radar_dias').delete().in('fecha', fechas), 'Quitar días');
  }
  async guardarPedidos(filas: FilaPedido[]) {
    await enParalelo(trozos(filas, 1000).map((t) => async () => { revisar(await this.sb.from('pedidos').upsert(t, { onConflict: 'numero,origen' }), 'Guardar pedidos'); }), 4);
  }
  async guardarStore(data: unknown) {
    revisar(await this.sb.from('radar_store').upsert({ id: 1, data }, { onConflict: 'id' }), 'Guardar catálogo');
  }
  async guardarMeta(meta: Meta) {
    revisar(await this.sb.from('pedidos_meta').upsert({ id: 1, cortes: meta.cortes, asg_pend: meta.asg_pend }, { onConflict: 'id' }), 'Guardar cortes');
  }
  async registrarCarga(origen: string, detalle: unknown) {
    try { await this.sb.from('cargas').insert({ origen, detalle }); } catch { /* la bitácora no es crítica */ }
  }
}
