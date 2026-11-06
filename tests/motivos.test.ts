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

import { fillRateCD } from '../src/core/negados/motivos';

describe('Días guardados sin líneas (antes del 6 nov)', () => {
  it('un archivo que trae parte del día suma lo que falta sin duplicar', () => {
    const R = new RadarNegados();
    R.integrar([r(1, 'a', 0, 'Físico no se encuentra'), r(2, 'b', 0, 'Existencia a cero')]);
    const h = R.history['2026-11-03'] as DiaResumen;
    delete h.mot!.l; delete h.mot!.p; delete h.mot!.bp;            // como quedó guardado antes del cambio
    R.integrar([r(2, 'b', 0, 'Existencia a cero'), r(3, 'c', 0, 'Pasillo bloqueado')]);
    expect(h.mot!.n).toBe(3);
    expect(h.mot!.m).toEqual({ 'Físico no se encuentra': 1, 'Existencia a cero': 1, 'Pasillo bloqueado': 1 });
  });
});

describe('Fill rate: todas las negadas cuentan', () => {
  const base = (ped: number, sku: string, prep: number, mot: string, razon = 'EXISTENCIA', disp = 0): Registro => ({
    Pedido: String(ped), SKU: sku, Estado: 'A', Fecha: new Date('2026-11-03T08:00:00'), FechaAct: new Date('2026-11-03T10:00:00'), FechaRevision: null,
    Sucursal: 'S', Orden: 'O' + ped, Preparador: 'P1 - Ana', Cantidad: 2, CantPrep: prep, Disponible: disp, Desc: 'd', Categoria: 'c', Motivo: mot, Razon: razon,
  });
  it('incluye las negadas por existencia a cero (tarjeta y B2B)', () => {
    const R = new RadarNegados();
    R.integrar([
      base(1, 'a', 2, ''), base(1, 'b', 0, 'Existencia a cero'),                       // B2B: no cumple (la negada cuenta)
      base(2, 'a', 2, ''), base(2, 'c', 0, 'Físico no se encuentra'),                  // B2B: no cumple
      base(3, 'd', 0, 'Existencia a cero'),                                           // B2B: no cumple
      base(6, 'g', 2, ''),                                                            // B2B: cumple
      base(4, 'e', 2, '', 'EXISTENCIA'), base(5, 'f', 0, 'Sin existencia ubicación picking', 'EXISTENCIA'),
    ].map((r, i) => (i < 6 ? { ...r, Razon: 'VENTA CORPORATIVA' } : r)));
    const f = fillRateCD(R.history, ['2026-11-03']);
    expect(f).toMatchObject({ prep: 4, neg: 4, base: 8 });
    expect(f.pct).toBeCloseTo(50);
    const b = R.fillRateB2B('2026-11-03', '2026-11-03');
    expect([b.tot, b.ok]).toEqual([4, 1]);
  });
});
