import { describe, it, expect } from 'vitest';
import { resumirRpt, abc } from '../src/core/picking/resumen';
import type { Registro } from '../src/core/negados/tipos';

const D = (s: string) => new Date(s);
const rec = (ped: number, sku: string, ubic: string, est: string, prep: number | null, disp: number, fecha = '2026-10-20T09:00:00', extra: Partial<Registro> = {}): Registro => ({
  Pedido: String(ped), Orden: 'O' + ped, SKU: sku, Ubic1: ubic, Ubic2: '', Cantidad: 4, CantPrep: prep, Disponible: disp, Estado: est, Sucursal: 'LOURDES',
  Desc: 'desc ' + sku, UM: 'Uni', Categoria: 'A', Preparador: 'P', Fecha: D(fecha), FechaRevision: null, FechaAct: null, ...extra,
} as unknown as Registro);

describe('Picking', () => {
  it('resume por día, código y ubicación, con negadas por motivo y sin duplicados', () => {
    const R = resumirRpt([
      rec(1, 'x', 'A-01', 'A', 4, 10), rec(1, 'x', 'A-01', 'A', 4, 10),            // duplicado: mismo pedido y código
      rec(2, 'x', 'A-01', 'A', 0, 10), rec(3, 'x', 'A-01', 'A', 0, 0), rec(4, 'x', 'A-01', 'A', 0, -2),
      rec(5, 'x', 'B-09', 'R', null, 10),                                            // otra ubicación, pendiente
      rec(6, 'y', '', 'A', 2, 5, '2026-10-21T08:00:00', { Ubic2: 'C-03' } as Partial<Registro>),
    ]);
    expect(R.dias).toEqual(['2026-10-20', '2026-10-21']);
    const fx = R.filas.find((f) => f.sku === 'x' && f.ubicacion === 'A-01')!;
    expect(fx).toMatchObject({ lineas: 4, unidades: 16, lineas_prep: 1, unid_prep: 4, neg_proceso: 1, neg_sinstock: 1, neg_negativo: 1, pendientes: 0, pedidos: 4 });
    expect(R.filas.find((f) => f.ubicacion === 'B-09')).toMatchObject({ lineas: 1, pendientes: 1 });
    expect(R.filas.find((f) => f.sku === 'y')!.ubicacion).toBe('C-03');
  });
  it('ABC por frecuencia: A hasta el 80% de las líneas, B hasta el 95%', () => {
    const r = (sku: string, lineas: number) => ({ sku, ubicacion: '', ubicaciones: 1, lineas, unidades: lineas, lineas_prep: lineas, neg_proceso: 0, neg_sinstock: 0, neg_negativo: 0, dias: 1, pedidos: lineas });
    const F = abc([r('a', 50), r('b', 30), r('c', 10), r('d', 6), r('e', 4)], new Map());
    expect(F.map((f) => f.sku + f.clase)).toEqual(['aA', 'bA', 'cB', 'dB', 'eC']);
  });
});
