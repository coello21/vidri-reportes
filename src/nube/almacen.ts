import type { Dia, Historial, StoreRadar } from '../core/negados/tipos';
import type { Pedido } from '../core/pedidos/catalogos';
import type { Corte } from '../core/pedidos/cd';
import type { BaseDatos, Progreso } from './base';
import { aFilaBase, aPedido, clavePed, type FilaPedido } from './filas';

export interface Datos {
  history: Historial;
  store: Partial<StoreRadar>;
  pedidos: { rows: Pedido[]; cortes: Corte[]; asgP: Record<string, number> };
}

export interface ResultadoGuardar { dias: number; diasQuitados: number; pedidos: number; catalogo: boolean; cortes: boolean }

const isoLocal = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
/** Minutos desde 1970 con la hora local de El Salvador guardada como si fuera UTC (así guarda la página los pedidos). */
export const minutosLocales = (d = new Date()) => Math.round(d.getTime() / 60000) - d.getTimezoneOffset();

/**
 * Lee los datos de la base y guarda solo lo que cambió.
 * Lleva una "foto" de lo que hay en la base para comparar.
 * Los pedidos viejos que la pantalla deja de mostrar NO se borran: quedan como historial.
 */
export class Almacen {
  private fDias = new Map<string, string>();
  private fPed = new Map<string, string>();
  private fStore: string | null = null;
  private fMeta: string | null = null;

  constructor(private base: BaseDatos) {}

  async leer(opc: { diasRadar: number; diasPedidos: number; todo?: boolean; hoy?: Date }, progreso?: Progreso): Promise<Datos> {
    const hoy = opc.hoy || new Date();
    const desde = opc.todo ? '1900-01-01' : isoLocal(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - opc.diasRadar));
    const corteMin = minutosLocales(hoy) - opc.diasPedidos * 1440;
    const [dias, store, ped, meta] = await Promise.all([
      this.base.leerDias(desde, progreso), this.base.leerStore(), this.base.leerPedidos(corteMin, progreso), this.base.leerMeta(),
    ]);
    const history: Historial = {};
    dias.forEach((r) => { history[r.fecha] = r.data; this.fDias.set(r.fecha, JSON.stringify(r.data)); });
    this.fStore = store ? JSON.stringify(store) : null;
    const rows = ped.map(aPedido);
    rows.forEach((x) => this.fPed.set(clavePed(x), JSON.stringify(x)));
    const cortes = (meta && meta.cortes) || [], asgP = (meta && meta.asg_pend) || {};
    this.fMeta = meta ? JSON.stringify({ cortes, asg: asgP }) : null;
    return { history, store: store || {}, pedidos: { rows, cortes, asgP } };
  }

  /**
   * Guarda lo que cambió respecto a lo leído.
   * `mesesConDias`: meses cuyos días se mandan completos; un día de esos meses que ya no
   * está en `history` se borra de la base (igual que hacía la página al quitar días).
   */
  async guardar(d: Partial<Datos>, origen: string, mesesConDias?: Set<string>): Promise<ResultadoGuardar> {
    const upDias: { fecha: string; data: Dia }[] = [], delDias: string[] = [], upPed: FilaPedido[] = [];
    const nDias = new Map<string, string>(), nPed = new Map<string, string>();
    if (d.history) {
      for (const f in d.history) {
        const s = JSON.stringify(d.history[f]);
        if (this.fDias.get(f) !== s) { upDias.push({ fecha: f, data: d.history[f] }); nDias.set(f, s); }
      }
      if (mesesConDias) this.fDias.forEach((_, f) => { if (mesesConDias.has(f.slice(0, 7)) && !(f in d.history!)) delDias.push(f); });
    }
    let nStore: string | null = null;
    if (d.store) { const s = JSON.stringify(d.store); if (s !== this.fStore) nStore = s; }
    if (d.pedidos) {
      for (const x of d.pedidos.rows) {
        const k = clavePed(x), s = JSON.stringify(x);
        if (this.fPed.get(k) !== s) { upPed.push(aFilaBase(x)); nPed.set(k, s); }
      }
    }
    let nMeta: { cortes: Corte[]; asg: Record<string, number>; s: string } | null = null;
    if (d.pedidos) {
      const s = JSON.stringify({ cortes: d.pedidos.cortes, asg: d.pedidos.asgP });
      if (s !== this.fMeta) nMeta = { cortes: d.pedidos.cortes, asg: d.pedidos.asgP, s };
    }
    const res: ResultadoGuardar = { dias: upDias.length, diasQuitados: delDias.length, pedidos: upPed.length, catalogo: !!nStore, cortes: !!nMeta };
    if (!upDias.length && !delDias.length && !upPed.length && !nStore && !nMeta) return res;

    await Promise.all([this.base.guardarDias(upDias), this.base.guardarPedidos(upPed)]);
    await this.base.borrarDias(delDias);
    if (nStore) await this.base.guardarStore(JSON.parse(nStore));
    if (nMeta) await this.base.guardarMeta({ cortes: nMeta.cortes, asg_pend: nMeta.asg });

    // Todo salió bien: se actualizan las fotos
    nDias.forEach((s, f) => this.fDias.set(f, s));
    delDias.forEach((f) => this.fDias.delete(f));
    nPed.forEach((s, k) => this.fPed.set(k, s));
    if (nStore) this.fStore = nStore;
    if (nMeta) this.fMeta = nMeta.s;

    await this.base.registrarCarga(origen, { dias: upDias.map((r) => r.fecha), dias_quitados: delDias, pedidos: upPed.length, catalogo: !!nStore, cortes: !!nMeta });
    return res;
  }
}
