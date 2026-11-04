import { describe, it, expect } from 'vitest';
import { RadarNegados } from '../src/core/negados/radar';
import { motivosDePreparador } from '../src/core/negados/motivos';
import type { Registro, DiaResumen } from '../src/core/negados/tipos';

const r = (ped: number, sku: string, prep: number, mot: string | undefined, conCol = true): Registro => {
  const x: Registro = {
    Pedido: String(ped), SKU: sku, Estado: 'A', Fecha: new Date('2026-11-03T08:00:00'), FechaAct: new Date('2026-11-03T10:00:00'), FechaRevision: null,
    Sucursal: 'S', Orden: 'O' + ped, Preparador: 'P1 - Ana', Cantidad: 2, CantPrep: prep, Disponible: 0, Desc: 'd', Categoria: 'c',
  };
  if (conCol) x.Motivo = mot ?? null;
  return x;
};

describe('Motivo de negado registrado', () => {
  it('guarda los motivos por día, no duplica al cargar dos veces y un archivo parcial no lo baja', () => {
    const R = new RadarNegados();
    const file = () => [r(1, 'a', 0, 'Físico no se encuentra'), r(2, 'a', 0, 'Existencia a cero'), r(3, 'b', 0, ''), r(4, 'c', 2, undefined), r(1, 'a', 0, 'Físico no se encuentra')];
    expect(R.integrar(file()).motDias).toBe(1);
    const mot = (R.history['2026-11-03'] as DiaResumen).mot!;
    expect(mot.n).toBe(3);
    expect(mot.m).toEqual({ 'Físico no se encuentra': 1, 'Existencia a cero': 1, '': 1 });
    expect(R.integrar(file()).motDias).toBeUndefined();
    R.integrar([r(1, 'a', 0, 'Pasillo bloqueado')]);
    expect((R.history['2026-11-03'] as DiaResumen).mot!.n).toBe(3);
    expect(motivosDePreparador(R.history, ['2026-11-03'], 'P1 - Ana')).toEqual({ a: { 'Físico no se encuentra': 1, 'Existencia a cero': 1 }, b: { '': 1 } });
  });
  it('sin la columna no agrega nada', () => {
    const R = new RadarNegados();
    expect(R.integrar([r(1, 'a', 0, undefined, false)]).motDias).toBeUndefined();
    expect((R.history['2026-11-03'] as DiaResumen).mot).toBeUndefined();
  });
});
