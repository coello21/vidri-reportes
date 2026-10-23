import type { SupabaseClient } from '@supabase/supabase-js';
import type { Dia, StoreRadar } from '../core/negados/tipos';
import type { Corte } from '../core/pedidos/cd';
import type { FilaPedido } from './filas';

export interface Meta { cortes: Corte[]; asg_pend: Record<string, number> }
export type Progreso = (etiqueta: string, pct: number) => void;
export interface FiltroPedidos { antesDeMin?: number; sinTerminar?: boolean; actualizadoDesdeMin?: number }

/** Consulta de supabase-js (sus tipos encadenados son muy largos para escribirlos aquí). */
// deno-lint-ignore no-explicit-any
type Consulta = any;

/**
 * Lo que la aplicación necesita de la base. Hay una versión con Supabase (abajo)
 * y otra en memoria para las pruebas.
 */
export interface BaseDatos {
  /** Días desde `desde` (y antes de `antesDe`, si se da). */
  leerDias(desde: string, progreso?: Progreso, antesDe?: string): Promise<{ fecha: string; data: Dia }[]>;
  leerStore(): Promise<Partial<StoreRadar> | null>;
  /** Pedidos con fecha desde `desdeMin`; `opc` acota más (antes de, solo sin terminar, terminados desde). */
  leerPedidos(desdeMin: number, progreso?: Progreso, opc?: FiltroPedidos): Promise<FilaPedido[]>;
  leerMeta(): Promise<Meta | null>;
  guardarDias(filas: { fecha: string; data: Dia }[]): Promise<void>;
  borrarDias(fechas: string[]): Promise<void>;
  guardarPedidos(filas: FilaPedido[]): Promise<void>;
  guardarStore(data: unknown): Promise<void>;
  guardarMeta(meta: Meta): Promise<void>;
  registrarCarga(origen: string, detalle: unknown): Promise<void>;
}

/** Mensaje de error corto: si la respuesta llegó cortada, Supabase devuelve el texto crudo (datos), no un mensaje. */
export function msjError(e: { message?: string; code?: string } | null | undefined): string {
  const m = String(e?.message || e?.code || 'error');
  return m.length > 200 || /^\s*[[{"]/.test(m) ? 'la conexión con la base se cortó a medio camino (respuesta incompleta). Vuelve a cargar la página.' : m;
}
function revisar<T extends { error: { message?: string; code?: string } | null }>(r: T, que: string): T {
  if (r && r.error) throw new Error(que + ': ' + msjError(r.error));
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

/** Repite una lectura si Supabase falla un momento (errores 5xx o de red): hasta 4 intentos, esperando 1.5 s, 3 s y 6 s. */
export async function conReintentos<T>(fn: () => Promise<T>, intentos = 4, espera = 1500): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) { if (i >= intentos) throw e; await new Promise((ok) => setTimeout(ok, espera * 2 ** (i - 1))); }
  }
}

export class BaseSupabase implements BaseDatos {
  constructor(private sb: SupabaseClient) {}

  /** Lee una consulta grande en páginas, varias a la vez. */
  private async paginado<R>(tabla: string, columnas: string, filtro: (q: Consulta) => Consulta,
    orden: string[], tam: number, etiqueta: string, progreso?: Progreso): Promise<R[]> {
    const c = await conReintentos(async () => revisar(await filtro(this.sb.from(tabla).select(orden[0], { count: 'exact', head: true })), etiqueta));
    const paginas = Math.max(1, Math.ceil((c.count || 0) / tam));
    let hechas = 0;
    const tareas = Array.from({ length: paginas }, (_, p) => async () => {
      const r = await conReintentos(async () => {
        let q = filtro(this.sb.from(tabla).select(columnas));
        for (const o of orden) q = q.order(o);
        return revisar(await q.range(p * tam, p * tam + tam - 1), etiqueta);
      });
      hechas++;
      progreso?.(etiqueta, Math.round(hechas / paginas * 100));
      return (r.data || []) as unknown as R[];
    });
    return (await enParalelo(tareas, 4)).flat();
  }

  leerDias(desde: string, progreso?: Progreso, antesDe?: string) {
    const f = (q: Consulta) => { q = q.gte('fecha', desde); return antesDe ? q.lt('fecha', antesDe) : q; };
    return this.paginado<{ fecha: string; data: Dia }>('radar_dias', 'fecha,data', f, ['fecha'], 10, 'Negados por día', progreso);
  }
  async leerStore() {
    const r = revisar(await this.sb.from('radar_store').select('data').eq('id', 1).maybeSingle(), 'Catálogo');
    return r.data ? (r.data as { data: Partial<StoreRadar> }).data : null;
  }
  leerPedidos(desdeMin: number, progreso?: Progreso, opc: FiltroPedidos = {}) {
    const f = (q: Consulta) => {
      q = q.gte('fecha_min', desdeMin);
      if (opc.antesDeMin != null) q = q.lt('fecha_min', opc.antesDeMin);
      if (opc.sinTerminar) q = q.neq('estado', 'A');
      if (opc.actualizadoDesdeMin != null) q = q.gte('actualizado_min', opc.actualizadoDesdeMin);
      return q;
    };
    return this.paginado<FilaPedido>('pedidos', '*', f, ['numero', 'origen'], 1000, 'Pedidos', progreso);
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
