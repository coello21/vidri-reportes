import { combinarPedido, combinarMeta } from '../src/nube/combinar';
import type { FilaPedido } from '../src/nube/filas';

const f = (o: Partial<FilaPedido>): FilaPedido => ({ numero: '1', origen: '59', fecha_min: 100, estado: 'R', skus: 3, motivo: 'exi',
  actualizado_min: 0, recibido_min: 100, corte_min: 1000, bodega: 'N', asignado_min: null, ...o });

test('una página abierta desde antes no pisa un pedido más nuevo de la base, pero le pone su hora de asignación', () => {
  const pag = f({ estado: 'R', corte_min: 1000, asignado_min: 150 });          // la página: corte del mediodía + asignación
  const db = f({ estado: 'A', actualizado_min: 900, corte_min: 2000 });          // el pipeline: corte de la tarde, ya actualizado
  expect(combinarPedido(pag, db)).toEqual({ ...db, asignado_min: 150 });
});

test('si la página trae lo más nuevo, gana la página y conserva la asignación más temprana', () => {
  const pag = f({ estado: 'P', corte_min: 3000, asignado_min: 200 });
  const db = f({ estado: 'R', corte_min: 2000, asignado_min: 180 });
  expect(combinarPedido(pag, db)).toEqual({ ...pag, asignado_min: 180 });
  expect(combinarPedido(pag, undefined)).toBe(pag);
});

test('los cortes y asignaciones que otro agregó después de abrir la página no se pierden', () => {
  const c = (t: number, cargado: string) => ({ t, ini: 0, fin: t, n: 1, cargado });
  const orig = { cortes: [c(1, 'a')], asg: { 'x-1': 5, 'y-1': 6 } };
  const pag = { cortes: [c(1, 'a')], asg: { 'x-1': 5, 'y-1': 6, 'z-1': 7 } };      // la página agregó z
  const ahora = { cortes: [c(1, 'a'), c(2, 'b')], asg: { 'x-1': 5, 'w-1': 8 } };    // otro agregó el corte b y w; ya aplicó y
  const m = combinarMeta(pag, orig, ahora);
  expect(m.cortes.map((x) => x.cargado)).toEqual(['a', 'b']);
  expect(m.asg).toEqual({ 'x-1': 5, 'z-1': 7, 'w-1': 8 });
});
