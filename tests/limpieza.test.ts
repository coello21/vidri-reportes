import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { limpiarRpt } from '../src/core/limpieza/rpt';
import { excelLimpio } from '../src/core/limpieza/excel';
import { leerExcelNegados } from '../src/core/negados/parseo';
import { RadarNegados } from '../src/core/negados/radar';

const H = ['Sucursal', 'Orden de Preparación', 'Pedido', 'SKU', 'Ubicación 1', 'Ubicación 2', 'Cantidad', 'Cantidad Preparada', 'UM', 'Disponible',
  'Motivo de negado', 'Razon de Pedido', 'Descripción', 'Categoría', 'Estado', 'Preparador', 'Revisador', 'Fecha Creación', 'Fecha Enviado Revisión', 'Fecha Actualizado'];
const fila = (i: number, o: Partial<Record<string, unknown>> = {}) => {
  const b: Record<string, unknown> = {
    Sucursal: ' TIENDA ' + (i % 3) + ' ', 'Orden de Preparación': 'OP' + i, Pedido: 1000 + i, SKU: 500 + (i % 7), 'Ubicación 1': '01A1', 'Ubicación 2': null,
    Cantidad: 4, 'Cantidad Preparada': i % 4 ? 4 : 0, UM: 'UNI', Disponible: i % 2 ? 3 : 0, 'Motivo de negado': i % 4 ? null : (i % 8 ? 'Existencia a cero' : null),
    'Razon de Pedido': i % 5 ? 'EXISTENCIA' : 'VENTA CORPORATIVA', Descripción: 'Producto ' + (i % 7), Categoría: 'A', Estado: i % 9 ? 'a' : 'P',
    Preparador: 'P' + (i % 3) + ' - Prep', Revisador: 'R', 'Fecha Creación': new Date(2026, 10, 3, 7, i % 50), 'Fecha Enviado Revisión': new Date(2026, 10, 3, 9, i % 50),
    'Fecha Actualizado': i % 9 ? new Date(2026, 10, 3 + (i % 2), 10, i % 50, 30) : null,
  };
  return H.map((k) => (k in o ? o[k] : b[k]));
};
const libro = (rows: unknown[][]) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'x'); return XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }) as Uint8Array; };

describe('Limpieza del Rpt', () => {
  const crudo = [['Reporte de órdenes'], [], H, ...Array.from({ length: 120 }, (_, i) => fila(i)), fila(3), H.map(() => null), fila(0, { SKU: null, Sucursal: 'TOTAL' })];
  it('quita filas sin código y repetidas idénticas, y cuenta la calidad', () => {
    const { filas, calidad } = limpiarRpt(crudo);
    expect(calidad.leidas).toBe(122);
    expect(calidad.sinCodigo).toBe(1);
    expect(calidad.repetidasIdenticas).toBe(1);
    expect(filas.length).toBe(120);
    expect(filas[0].Sucursal).toBe('TIENDA 0');
    expect(limpiarRpt([H, fila(201, { Preparador: '  9 - JUAN  PEREZ ' })]).filas[0].Preparador).toBe('9 - JUAN  PEREZ');
    expect(filas[0].Estado).toBe('P');
    expect(limpiarRpt([H, fila(200, { 'Motivo de negado': '  existencia  a  CERO ' })]).filas[0].Motivo).toBe('Existencia a cero');
    expect(limpiarRpt([H, fila(200, { 'Motivo de negado': 'Otro motivo nuevo' })]).calidad.motivosDesconocidos).toEqual({ 'Otro motivo nuevo': 1 });
    expect(calidad.negadas).toBeGreaterThan(0);
    expect(calidad.negadasSinMotivo).toBeGreaterThan(0);
    expect(calidad.columnasIgnoradas).toEqual(['Revisador']);
  });
  it('el Radar da exactamente lo mismo con el archivo crudo y con el limpio', () => {
    // como la página: se lee el crudo sin convertir fechas
    const wbC = XLSX.read(libro(crudo), { type: 'array' });
    const { filas, calidad } = limpiarRpt(XLSX.utils.sheet_to_json<unknown[]>(wbC.Sheets[wbC.SheetNames[0]], { header: 1, raw: true, defval: null }));
    const limpio = excelLimpio(filas, calidad.conColumnaMotivo, [['x', 1]]);
    const A = new RadarNegados(), B = new RadarNegados();
    A.integrar(leerExcelNegados(libro(crudo)));
    B.integrar(leerExcelNegados(limpio));
    expect(JSON.stringify(B.history)).toBe(JSON.stringify(A.history));
    const sA = { ...A.store, updatedAt: '' }, sB = { ...B.store, updatedAt: '' };
    expect(JSON.stringify(sB)).toBe(JSON.stringify(sA));
  });
  it('avisa si no es el reporte o faltan columnas', () => {
    expect(() => limpiarRpt([['a', 'b']])).toThrow(/encabezados/);
    expect(() => limpiarRpt([['Sucursal', 'SKU']])).toThrow(/Faltan columnas/);
  });
});
