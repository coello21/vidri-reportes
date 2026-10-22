/** Picking en Supabase: picking_dia (día × código × ubicación) y picking_codigos. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Codigo, FilaPicking, ResumenCodigo } from '../core/picking/resumen';
import { trozos, enParalelo } from './base';

function revisar<T extends { error: { message?: string } | null }>(r: T, que: string): T {
  if (r.error) throw new Error(que + ': ' + (r.error.message || 'error'));
  return r;
}

export class BasePicking {
  constructor(private sb: SupabaseClient) {}

  /**
   * Reemplaza los días que trae el archivo (cargar dos veces no duplica), salvo los días que ya se llenaron
   * con un archivo más nuevo. Devuelve los días guardados y los que se dejaron como estaban.
   */
  async reemplazarDias(dias: string[], filas: FilaPicking[], corte: number, archivo: string, progreso?: (pct: number) => void): Promise<{ guardados: string[]; omitidos: string[] }> {
    const prev = new Map<string, number>();
    for (const t of trozos(dias, 200)) {
      const r = revisar(await this.sb.from('picking_cortes').select('dia,corte').in('dia', t), 'Cortes');
      ((r.data || []) as { dia: string; corte: number }[]).forEach((x) => prev.set(x.dia, Number(x.corte)));
    }
    const guardados = dias.filter((d) => !prev.has(d) || corte >= prev.get(d)!), omitidos = dias.filter((d) => !guardados.includes(d));
    if (!guardados.length) return { guardados, omitidos };
    const ok = new Set(guardados);
    filas = filas.filter((f) => ok.has(f.dia));
    for (const t of trozos(guardados, 50)) revisar(await this.sb.from('picking_dia').delete().in('dia', t), 'Borrar días anteriores');
    const partes = trozos(filas, 1000); let hechas = 0;
    await enParalelo(partes.map((t) => async () => { revisar(await this.sb.from('picking_dia').insert(t), 'Guardar picking'); hechas++; progreso?.(Math.round(hechas / partes.length * 100)); }), 4);
    revisar(await this.sb.from('picking_cortes').upsert(guardados.map((dia) => ({ dia, corte, archivo, cargado: new Date().toISOString() })), { onConflict: 'dia' }), 'Guardar cortes');
    return { guardados, omitidos };
  }
  async guardarCodigos(c: Codigo[]) {
    await enParalelo(trozos(c, 1000).map((t) => async () => { revisar(await this.sb.from('picking_codigos').upsert(t, { onConflict: 'sku' }), 'Guardar códigos'); }), 4);
  }
  async cobertura(): Promise<{ dia: string; lineas: number; codigos: number }[]> {
    const out: { dia: string; lineas: number; codigos: number }[] = [];
    for (let p = 0; ; p++) {
      const r = revisar(await this.sb.rpc('picking_cobertura').range(p * 1000, p * 1000 + 999), 'Días cargados');
      const d = (r.data || []) as { dia: string; lineas: number; codigos: number }[];
      out.push(...d.map((x) => ({ dia: x.dia, lineas: Number(x.lineas), codigos: Number(x.codigos) })));
      if (d.length < 1000) break;
    }
    return out;
  }
  /** Resumen por código en el rango (la base suma; se recibe en páginas). */
  async resumen(desde: string, hasta: string, progreso?: (n: number) => void): Promise<ResumenCodigo[]> {
    const out: ResumenCodigo[] = [];
    for (let p = 0; ; p++) {
      const r = revisar(await this.sb.rpc('picking_resumen', { desde, hasta }).range(p * 1000, p * 1000 + 999), 'Resumen');
      const d = (r.data || []) as Record<string, unknown>[];
      out.push(...d.map((x) => ({
        sku: String(x.sku), ubicacion: String(x.ubicacion ?? ''), ubicaciones: Number(x.ubicaciones), lineas: Number(x.lineas), unidades: Number(x.unidades),
        lineas_prep: Number(x.lineas_prep), neg_proceso: Number(x.neg_proceso), neg_sinstock: Number(x.neg_sinstock), neg_negativo: Number(x.neg_negativo),
        dias: Number(x.dias), pedidos: Number(x.pedidos),
      })));
      progreso?.(out.length);
      if (d.length < 1000) break;
    }
    return out;
  }
  async codigos(): Promise<Codigo[]> {
    const out: Codigo[] = [];
    for (let p = 0; ; p++) {
      const r = revisar(await this.sb.from('picking_codigos').select('sku,descripcion,um,categoria').order('sku').range(p * 1000, p * 1000 + 999), 'Códigos');
      const d = (r.data || []) as Codigo[]; out.push(...d);
      if (d.length < 1000) break;
    }
    return out;
  }
  async registrarCarga(detalle: unknown) {
    try { await this.sb.from('cargas').insert({ origen: 'picking', detalle }); } catch { /* la bitácora no es crítica */ }
  }
}
