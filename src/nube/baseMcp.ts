/**
 * Lectura de la base por el conector de Supabase de Claude (para el Radar publicado como artefacto).
 * Mismas lecturas que BaseSupabase, en trozos pequeños (cada respuesta del conector debe ser liviana).
 * Solo lee: el artefacto no carga Excel ni guarda nada (eso lo hace el pipeline).
 */
import type { Dia, StoreRadar } from '../core/negados/tipos';
import type { BaseDatos, FiltroPedidos, Meta, Progreso } from './base';
import { conReintentos, enParalelo } from './base';
import type { FilaPedido } from './filas';

export const PROYECTO = 'mtyhrvvclqfhhwipfrli';
export const SERVIDOR = 'Supabase';

interface Mcp { callTool(server: string, tool: string, input?: unknown, opc?: unknown): Promise<{ payload?: unknown; content?: { type: string; text?: string }[] }> }

/** Filas de la respuesta de execute_sql: vienen entre <untrusted-data-…> y </untrusted-data-…> (solo datos). */
export function filasDe(x: unknown): Record<string, unknown>[] {
  for (let i = 0; i < 6 && x != null; i++) {
    if (Array.isArray(x)) return x as Record<string, unknown>[];
    if (typeof x === 'string') {
      const e = x.lastIndexOf('</untrusted-data-'), o = e < 0 ? -1 : x.lastIndexOf('<untrusted-data-', e), g = o < 0 ? -1 : x.indexOf('>', o);
      try { x = JSON.parse(g > 0 ? x.slice(g + 1, e) : x); } catch { throw new Error('respuesta de la base incompleta'); }
      continue;
    }
    if (typeof x === 'object') { const r = (x as Record<string, unknown>).result ?? (x as Record<string, unknown>).rows; if (r === undefined) break; x = r; continue; }
    break;
  }
  throw new Error('respuesta inesperada de la base');
}

const txt = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const num = (n: number) => { if (!Number.isFinite(n)) throw new Error('número inválido'); return String(Math.trunc(n)); };

export class BaseMcp implements BaseDatos {
  constructor(private mcp: Mcp) {}

  /** Una consulta de solo lectura. */
  private async sql(query: string): Promise<Record<string, unknown>[]> {
    return conReintentos(async () => {
      const r = await this.mcp.callTool(SERVIDOR, 'execute_sql', { project_id: PROYECTO, query }, { cache: false });
      return filasDe(r.payload !== undefined ? r.payload : r.content?.[0]?.text);
    }, 2, 2000);
  }

  async leerDias(desde: string, progreso?: Progreso, antesDe?: string) {
    const w = 'fecha >= ' + txt(desde) + (antesDe ? ' and fecha < ' + txt(antesDe) : '');
    const fechas = (await this.sql('select fecha::text f from radar_dias where ' + w + ' order by fecha')).map((r) => String(r.f));
    const grupos: string[][] = [];
    for (let i = 0; i < fechas.length; i++) grupos.push([fechas[i]]);  // un día por consulta (~200 KB)
    let hechas = 0;
    const partes = await enParalelo(grupos.map((g) => async () => {
      const rows = await this.sql('select fecha::text fecha, data from radar_dias where fecha in (' + g.map(txt).join(',') + ') order by fecha');
      progreso?.('Negados por día', Math.round(++hechas / grupos.length * 100));
      return rows.map((r) => ({ fecha: String(r.fecha), data: r.data as Dia }));
    }), 3);
    return partes.flat();
  }

  /** Una parte del catálogo; las grandes (objetos) se leen en trozos de claves. */
  private async parteStore(k: string): Promise<unknown> {
    const t = await this.sql('select jsonb_typeof(data->' + txt(k) + ') t, case when jsonb_typeof(data->' + txt(k) + ") = 'object' then (select count(*) from jsonb_object_keys(data->" + txt(k) + ')) end n, octet_length((data->' + txt(k) + ')::text) b from radar_store where id = 1');
    if (!t.length || t[0].t == null) return undefined;
    const b = Number(t[0].b || 0), n = Number(t[0].n || 0);
    if (t[0].t !== 'object' || b < 300_000) return (await this.sql('select data->' + txt(k) + ' v from radar_store where id = 1'))[0]?.v;
    const tam = Math.max(1, Math.ceil(n / Math.ceil(b / 250_000))), tareas = [];
    for (let o = 0; o < n; o += tam) {
      const off = o;
      tareas.push(async () => (await this.sql('select jsonb_object_agg(e.key, e.value) v from (select key, value from radar_store, jsonb_each(data->' + txt(k) + ') where id = 1 order by key offset ' + num(off) + ' limit ' + num(tam) + ') e'))[0]?.v as Record<string, unknown> | null);
    }
    const out: Record<string, unknown> = {};
    (await enParalelo(tareas, 3)).forEach((p) => Object.assign(out, p || {}));
    return out;
  }

  async leerStore(claves?: string[]) {
    const ks = claves && claves.length ? claves : (await this.sql('select jsonb_object_keys(data) k from radar_store where id = 1')).map((r) => String(r.k));
    const o: Record<string, unknown> = {};
    const vals = await enParalelo(ks.map((k) => async () => [k, await this.parteStore(k)] as const), 3);
    for (const [k, v] of vals) if (v != null) o[k] = v;
    return Object.keys(o).length ? (o as Partial<StoreRadar>) : null;
  }

  async leerPedidos(desdeMin: number, progreso?: Progreso, opc: FiltroPedidos = {}) {
    let w = 'fecha_min >= ' + num(desdeMin);
    if (opc.antesDeMin != null) w += ' and fecha_min < ' + num(opc.antesDeMin);
    if (opc.sinTerminar) w += " and estado <> 'A'";
    if (opc.actualizadoDesdeMin != null) w += ' and actualizado_min >= ' + num(opc.actualizadoDesdeMin);
    const n = Number((await this.sql('select count(*) n from pedidos where ' + w))[0]?.n || 0), tam = 1000;
    const paginas = Math.max(1, Math.ceil(n / tam));
    let hechas = 0;
    const partes = await enParalelo(Array.from({ length: paginas }, (_, p) => async () => {
      const rows = await this.sql('select * from pedidos where ' + w + ' order by numero, origen offset ' + num(p * tam) + ' limit ' + num(tam));
      progreso?.('Pedidos', Math.round(++hechas / paginas * 100));
      return rows as unknown as FilaPedido[];
    }), 3);
    return partes.flat();
  }

  async leerPedidosClaves(): Promise<FilaPedido[]> { throw new Error('solo lectura'); }

  async leerMeta() {
    const r = await this.sql('select cortes, asg_pend from pedidos_meta where id = 1');
    return r.length ? (r[0] as unknown as Meta) : null;
  }

  // El artefacto solo lee: los Excel se suben por la página de carga y los guarda el pipeline.
  async guardarDias() { throw new Error('solo lectura'); }
  async borrarDias() { throw new Error('solo lectura'); }
  async guardarPedidos() { throw new Error('solo lectura'); }
  async guardarStore() { throw new Error('solo lectura'); }
  async guardarMeta() { throw new Error('solo lectura'); }
  async registrarCarga() { /* nada */ }
}
