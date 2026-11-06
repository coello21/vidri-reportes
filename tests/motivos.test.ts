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
    expect(motivosDePreparador(R.history, ['2026-11-03'], 'P1 - Ana')).toEqual({ a: { 'Físico no se encuentra': 1, 'Existencia a cero': 1 }, b: { '': 1 } });
    // un archivo parcial (el de la mañana siguiente) suma la línea que faltaba y no borra las demás
    R.integrar([r(9, 'z', 0, 'Pasillo bloqueado')]);
    const m2 = (R.history['2026-11-03'] as DiaResumen).mot!;
    expect(m2.n).toBe(4);
    expect(m2.m).toEqual({ 'Físico no se encuentra': 1, 'Existencia a cero': 1, '': 1, 'Pasillo bloqueado': 1 });
    // la misma línea en otro archivo no se cuenta dos veces
    R.integrar([r(9, 'z', 0, 'Pasillo bloqueado'), r(2, 'a', 0, 'Existencia a cero')]);
    expect((R.history['2026-11-03'] as DiaResumen).mot!.n).toBe(4);
  });
  it('sin la columna no agrega nada', () => {
    const R = new RadarNegados();
    expect(R.integrar([r(1, 'a', 0, undefined, false)]).motDias).toBeUndefined();
    expect((R.history['2026-11-03'] as DiaResumen).mot).toBeUndefined();
  });
});

import { fillRateCD, exclusionPorPreparador } from '../src/core/negados/motivos';

describe('Fill rate sin «Existencia a cero»', () => {
  const base = (ped: number, sku: string, prep: number, mot: string, razon = 'EXISTENCIA', disp = 0): Registro => ({
    Pedido: String(ped), SKU: sku, Estado: 'A', Fecha: new Date('2026-11-03T08:00:00'), FechaAct: new Date('2026-11-03T10:00:00'), FechaRevision: null,
    Sucursal: 'S', Orden: 'O' + ped, Preparador: 'P1 - Ana', Cantidad: 2, CantPrep: prep, Disponible: disp, Desc: 'd', Categoria: 'c', Motivo: mot, Razon: razon,
  });
  it('quita del fill rate las negadas por existencia a cero (tarjeta, preparador y B2B)', () => {
    const R = new RadarNegados();
    R.integrar([
      base(1, 'a', 2, ''), base(1, 'b', 0, 'Existencia a cero'),                       // B2B: cumple (la negada no cuenta)
      base(2, 'a', 2, ''), base(2, 'c', 0, 'Físico no se encuentra'),                  // B2B: no cumple
      base(3, 'd', 0, 'Existencia a cero'),                                           // B2B entero sin existencia: no cuenta
      base(4, 'e', 2, '', 'EXISTENCIA'), base(5, 'f', 0, 'Sin existencia ubicación picking', 'EXISTENCIA'),
    ].map((r, i) => (i < 5 ? { ...r, Razon: 'VENTA CORPORATIVA' } : r)));
    const f = fillRateCD(R.history, ['2026-11-03']);
    expect(f).toMatchObject({ prep: 3, neg: 4, excl: 2, base: 5 });
    expect(f.pct).toBeCloseTo(60);
    expect(exclusionPorPreparador(R.history, ['2026-11-03'])).toEqual({ 'P1 - Ana': 2 });
    const b = R.fillRateB2B('2026-11-03', '2026-11-03');
    expect([b.tot, b.ok]).toEqual([2, 1]);
  });
  it('días sin motivo registrado: quita las de disponible 0 o negativo', () => {
    const R = new RadarNegados();
    const sin = (r: Registro) => { const x = { ...r }; delete x.Motivo; return x; };
    R.integrar([sin(base(1, 'a', 2, '')), sin(base(2, 'b', 0, '', 'X', 0)), sin(base(3, 'c', 0, '', 'X', 5))]);
    const f = fillRateCD(R.history, ['2026-11-03']);
    expect(f).toMatchObject({ prep: 1, neg: 2, excl: 1, base: 2 });
  });
});
