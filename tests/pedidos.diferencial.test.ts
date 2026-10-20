/** Pedidos: lectura del Excel, integración de cortes y hora de asignación, igual que el tablero original. */
import { describe, it, expect } from 'vitest';
import { PedidosCD, leerExcelPedidos, leerExcelAsignacion, filasAAsignacion } from '../src/core';
import { pedidosOriginal } from './helpers/original';
import { documentoPedidos, rptOrdenes, aXlsx } from './helpers/sinteticos';

const min = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) / 60000;
const json = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('Pedidos CD: igual que el tablero original', () => {
  for (const semilla of [3, 11, 99]) {
    it(`tres cortes seguidos (semilla ${semilla})`, () => {
      const O = pedidosOriginal();
      const ts = new PedidosCD();
      const cortes = [
        documentoPedidos(semilla, min(2026, 10, 10), 5, 1500, min(2026, 10, 15, 8)),
        documentoPedidos(semilla, min(2026, 10, 10), 5, 1500, min(2026, 10, 15, 12)),
        documentoPedidos(semilla + 5, min(2026, 10, 12), 4, 1200, min(2026, 10, 15, 17)),
      ];
      cortes.forEach((filas, i) => {
        const buf = aXlsx(filas);
        const pO = O.pedParse(buf, false);
        const pT = leerExcelPedidos(buf);
        expect(json(pT)).toEqual(json(pO));
        const rO = O.pedIntegrate(pO.rows);
        const rT = ts.integrar(pT.rows, O.PED.cortes.at(-1)?.cargado);
        expect(rT).toEqual(rO);
        if (i === 1) {
          // hora de asignación desde un Rpt_OrdenesPreparacion
          const rpt = rptOrdenes(semilla, new Date(2026, 9, 12, 6), 3, 600);
          const b = aXlsx(rpt);
          const aO = O.pedAsgParse(b);
          const aT = leerExcelAsignacion(b)!;
          expect(aT.M.size).toBeGreaterThan(10);
          expect([...aT.M]).toEqual([...aO.M]);
          expect(aT.sinSuc).toBe(aO.sinSuc);
          expect(json(ts.aplicarAsignacion(aT.M))).toEqual(json(O.pedAsgApply(aO.M)));
        }
      });
      const rowsO = [...O.PED.rows.entries()].sort();
      const rowsT = [...ts.rows.entries()].sort();
      expect(rowsT.length).toBeGreaterThan(100);
      expect(json(rowsT)).toEqual(json(rowsO));
      expect(ts.cortes.map((c) => c.t)).toEqual(O.PED.cortes.map((c: any) => c.t));
      expect(json(ts.asgP)).toEqual(json(O.PED.asgP));
      expect(ts.vigentes().length).toBe(O.pedRowsB().length);
      expect(ts.pendientes(['R']).ok.length).toBe(O.pedBacklog(new Set(['R'])).ok.length);
    });
  }

  it('el Rpt de órdenes no se confunde con el de pedidos', () => {
    expect(filasAAsignacion(documentoPedidos(1, min(2026, 10, 1), 1, 5, min(2026, 10, 2)))).toBeNull();
    expect(() => leerExcelPedidos(aXlsx([['hola'], [1, 2]]))).toThrow(/Número Pedido/);
  });
});
