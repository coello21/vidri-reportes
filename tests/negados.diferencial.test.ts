/**
 * Compara la versión TypeScript contra el código original del tablero, con reportes
 * sintéticos que incluyen duplicados, reasignaciones, pendientes, celdas vacías y B2B.
 * Si alguna regla cambia sin querer, esta prueba falla.
 */
import { describe, it, expect } from 'vitest';
import { RadarNegados, leerExcelNegados } from '../src/core';
import { negadosOriginal } from './helpers/original';
import { rptOrdenes, aXlsx } from './helpers/sinteticos';

const limpiar = (s: any) => { const c = JSON.parse(JSON.stringify(s)); delete c.updatedAt; return c; };

describe('Radar de negados: igual que el tablero original', () => {
  for (const semilla of [1, 7, 42, 2026]) {
    it(`cargas sucesivas (semilla ${semilla})`, () => {
      const O = negadosOriginal();
      O.HISTORY = {}; O.STORE = null;
      const ts = new RadarNegados({}, null);

      // Tres cortes del día: cada reporte trae "ayer + hoy" y se va completando
      const base = new Date(2026, 9, 12, 6, 0);
      const cargas = [
        rptOrdenes(semilla, base, 2, 400),
        rptOrdenes(semilla + 1, new Date(2026, 9, 13, 6, 0), 2, 500),
        rptOrdenes(semilla, base, 2, 400).concat(rptOrdenes(semilla + 2, new Date(2026, 9, 14, 6, 0), 1, 300).slice(3)),
      ];
      for (const filas of cargas) {
        const buf = aXlsx(filas);
        const recO = O.parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        const recT = leerExcelNegados(buf);
        expect(recT.length).toBe(recO.length);
        const resO = O.integrateRecords(recO);
        const resT = ts.integrar(recT);
        expect(resT).toEqual(JSON.parse(JSON.stringify(resO)));
      }
      expect(Object.keys(ts.history).length).toBeGreaterThan(1);
      expect(Object.keys(ts.store.pending).length).toBeGreaterThan(0);
      expect(Object.keys(ts.store.b2b).length).toBeGreaterThan(0);
      expect(limpiar(ts.history)).toEqual(limpiar(O.HISTORY));
      expect(limpiar(ts.store)).toEqual(limpiar(O.STORE));

      // Vistas: cada día y el rango completo
      for (const d of Object.keys(ts.history)) {
        expect(JSON.parse(JSON.stringify(ts.agregado(d, d)))).toEqual(JSON.parse(JSON.stringify(O.buildAggregatedVM(d, d))));
        expect(ts.isPartialDay(d)).toBe(O.isPartialDay(d));
      }
      expect(JSON.parse(JSON.stringify(ts.agregado()))).toEqual(JSON.parse(JSON.stringify(O.buildAggregatedVM(null, null))));
      const dias = Object.keys(ts.history).sort();
      const b2bO = O.b2bForDates(dias);
      const b2bT = ts.fillRateB2B(dias[0], dias[dias.length - 1]);
      expect({ tot: b2bT.tot, ok: b2bT.ok, enProceso: b2bT.enProceso }).toEqual({ ...b2bO });
    });
  }
});
