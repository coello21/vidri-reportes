import { describe, it, expect } from 'vitest';
import { PedidosCD } from '../src/core/pedidos/cd';
import type { Pedido } from '../src/core/pedidos/catalogos';

const D = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0)) / 60000;
const LC = D('2026-10-22 07:38');
const p = (n: number, f: string, est: string, act: string | null): Pedido => [n, 67, D(f), est, 3, 'exi', act ? D(act) : 0, D(f), LC, 'N'] as unknown as Pedido;

describe('Pendiente por fecha del pedido', () => {
  it('cuadra con el balance del día: días anteriores = Inició, + hoy = Entraron, sin terminar = Al corte', () => {
    const ped = new PedidosCD({
      rows: [
        p(1, '2026-10-22 06:00', 'R', null),               // hoy, sin empezar
        p(2, '2026-10-21 10:00', 'R', null),               // ayer, sigue sin empezar
        p(3, '2026-10-21 11:00', 'A', '2026-10-22 07:00'), // ayer, terminado hoy
        p(4, '2026-10-21 12:00', 'A', '2026-10-21 18:00'), // ayer, terminado ayer: no cuenta
        p(5, '2026-10-20 09:00', 'P', null),               // antier, en proceso
        p(6, '2026-10-01 09:00', 'P', null),               // viejo: va en "días anteriores"
      ],
      cortes: [{ t: LC, ini: 0, fin: 0, n: 6, cargado: 'x' }],
    });
    const R = ped.porFecha()!;
    expect(R.hoy).toBe('2026-10-22');
    const fila = (d: string | null) => R.filas.find((f) => f.dia === d)!;
    expect(fila('2026-10-22')).toMatchObject({ hoy: true, inicio: 1, sinEmpezar: 1, terminados: 0 });
    expect(fila('2026-10-21')).toMatchObject({ inicio: 2, sinEmpezar: 1, terminados: 1 });
    expect(fila('2026-10-20')).toMatchObject({ inicio: 1, enProceso: 1 });
    expect(fila(null)).toMatchObject({ inicio: 1, enProceso: 1 });
    expect(R.filas.map((f) => f.dia)).toEqual(['2026-10-22', '2026-10-21', '2026-10-20', null]);
    const b = ped.balance().find((x) => x.cur)!;
    const ant = R.filas.filter((f) => !f.hoy).reduce((a, f) => a + f.inicio, 0);
    const sinTerminar = R.filas.reduce((a, f) => a + f.sinEmpezar + f.enProceso, 0);
    expect([ant, fila('2026-10-22').inicio, sinTerminar]).toEqual([b.ini, b.ent, b.fin]);
  });
});
