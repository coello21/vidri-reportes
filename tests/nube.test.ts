import { describe, it, expect } from 'vitest';
import { Almacen } from '../src/nube/almacen';
import type { BaseDatos, Meta } from '../src/nube/base';
import { aFilaBase, aPedido, type FilaPedido } from '../src/nube/filas';
import type { Pedido } from '../src/core/pedidos/catalogos';
import type { Dia } from '../src/core/negados/tipos';

/** Base en memoria que anota lo que se le pide guardar. */
class BaseMemoria implements BaseDatos {
  dias = new Map<string, Dia>();
  pedidos = new Map<string, FilaPedido>();
  store: unknown = null;
  meta: Meta | null = null;
  llamadas: string[] = [];
  cargas: unknown[] = [];
  async leerDias(desde: string) { return [...this.dias].filter(([f]) => f >= desde).map(([fecha, data]) => ({ fecha, data: structuredClone(data) })); }
  async leerStore() { return this.store ? structuredClone(this.store) as object : null; }
  async leerPedidos(desdeMin: number) { return [...this.pedidos.values()].filter((r) => r.fecha_min >= desdeMin).map((r) => ({ ...r })); }
  async leerMeta() { return this.meta ? structuredClone(this.meta) : null; }
  async guardarDias(f: { fecha: string; data: Dia }[]) { if (f.length) this.llamadas.push('dias:' + f.map((r) => r.fecha).join(',')); f.forEach((r) => this.dias.set(r.fecha, r.data)); }
  async borrarDias(f: string[]) { if (f.length) this.llamadas.push('borrar:' + f.join(',')); f.forEach((d) => this.dias.delete(d)); }
  async guardarPedidos(f: FilaPedido[]) { if (f.length) this.llamadas.push('pedidos:' + f.length); f.forEach((r) => this.pedidos.set(r.numero + '-' + r.origen, r)); }
  async guardarStore(d: unknown) { this.llamadas.push('store'); this.store = d; }
  async guardarMeta(m: Meta) { this.llamadas.push('meta'); this.meta = m; }
  async registrarCarga(_o: string, d: unknown) { this.cargas.push(d); }
}

const dia = (n: number): Dia => ({ v: 2, date: 'x', meta: { totalFinal: n, totalNegados: 1, totalPreparados: n - 1, exactas: 0 }, bucket: { positivo: 1, cero: 0, negativo: 0 }, codes: {}, stores: {}, hours: [], preps: {}, pairs: {}, prepSkus: {} } as unknown as Dia);
const HOY = new Date(2026, 9, 20, 9, 0);
const MIN_HOY = Math.round(HOY.getTime() / 60000) - HOY.getTimezoneOffset();

describe('filas de pedidos', () => {
  it('ida y vuelta entre la página y la base', () => {
    const casos: Pedido[] = [
      [12345, 67, MIN_HOY, 'R', 4, 'exi', 0, MIN_HOY + 5, MIN_HOY + 60, 'N'],
      ['00123', 'A1', MIN_HOY, 'A', 2, 'b2b', MIN_HOY + 90, MIN_HOY + 5, MIN_HOY + 60, 'B', MIN_HOY + 30],
    ];
    for (const x of casos) expect(aPedido(aFilaBase(x))).toEqual(x);
  });
});

describe('Almacen', () => {
  it('lee la base y solo guarda lo que cambió', async () => {
    const b = new BaseMemoria();
    b.dias.set('2026-10-19', dia(100)); b.dias.set('2026-10-18', dia(50)); b.dias.set('2026-01-01', dia(5));
    const p1: Pedido = [1, 67, MIN_HOY - 60, 'R', 3, 'exi', 0, MIN_HOY - 50, MIN_HOY, 'N'];
    const pViejo: Pedido = [2, 67, MIN_HOY - 90 * 1440, 'A', 3, 'exi', MIN_HOY - 89 * 1440, 0, MIN_HOY - 89 * 1440, 'N'];
    b.pedidos.set('1-67', aFilaBase(p1)); b.pedidos.set('2-67', aFilaBase(pViejo));
    b.store = { skus: { a: ['x', 'y', 'uni'] } };
    b.meta = { cortes: [{ t: MIN_HOY, ini: 0, fin: 0, n: 1, cargado: 'x' }], asg_pend: {} };

    const a = new Almacen(b);
    const d = await a.leer({ diasRadar: 120, diasPedidos: 62, hoy: HOY });
    expect(Object.keys(d.history).sort()).toEqual(['2026-10-18', '2026-10-19']); // el 1 de enero queda fuera de los 120 días
    expect(d.pedidos.rows).toEqual([p1]);                                        // el pedido de hace 90 días no se lee

    // sin cambios: no se guarda nada
    expect(await a.guardar(d, 'excel')).toEqual({ dias: 0, diasQuitados: 0, pedidos: 0, catalogo: false, cortes: false });
    expect(b.llamadas).toEqual([]);

    // cambia un día, entra un pedido nuevo, cambia un pedido y se agrega un corte
    d.history['2026-10-20'] = dia(10);
    (d.history['2026-10-19'] as unknown as { meta: { totalFinal: number } }).meta.totalFinal = 101;
    d.pedidos.rows[0] = [1, 67, MIN_HOY - 60, 'A', 3, 'exi', MIN_HOY, MIN_HOY - 50, MIN_HOY + 1, 'N'];
    d.pedidos.rows.push([3, 15, MIN_HOY, 'R', 1, 'otr', 0, MIN_HOY, MIN_HOY + 1, 'N']);
    d.pedidos.cortes.push({ t: MIN_HOY + 1, ini: 0, fin: 0, n: 2, cargado: 'y' });
    const r = await a.guardar(d, 'excel');
    expect(r).toEqual({ dias: 2, diasQuitados: 0, pedidos: 2, catalogo: false, cortes: true });
    expect(b.pedidos.get('2-67')).toBeDefined(); // los pedidos viejos no se borran

    // lo guardado ya es la nueva foto
    b.llamadas = [];
    expect((await a.guardar(d, 'excel')).dias).toBe(0);
    expect(b.llamadas).toEqual([]);

    // un día que desaparece de un mes que se manda completo se borra
    delete d.history['2026-10-18'];
    const r2 = await a.guardar(d, 'excel', new Set(['2026-10']));
    expect(r2.diasQuitados).toBe(1);
    expect(b.dias.has('2026-10-18')).toBe(false);
    expect(b.dias.has('2026-01-01')).toBe(true); // de otro mes: no se toca
  });

  it('si la base falla no actualiza la foto (se vuelve a intentar)', async () => {
    const b = new BaseMemoria();
    const a = new Almacen(b);
    const d = await a.leer({ diasRadar: 120, diasPedidos: 62, hoy: HOY });
    d.history['2026-10-20'] = dia(10);
    const orig = b.guardarDias.bind(b);
    b.guardarDias = async () => { throw new Error('sin red'); };
    await expect(a.guardar(d, 'excel')).rejects.toThrow('sin red');
    b.guardarDias = orig;
    expect((await a.guardar(d, 'excel')).dias).toBe(1);
  });
});
