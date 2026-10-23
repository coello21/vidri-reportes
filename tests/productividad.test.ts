import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { Productividad, acum, sumar, horas, valida } from '../src/core/productividad/calculo';
import { zona, categoria, clave } from '../src/core/productividad/listado';
import { leerAuditoria, type Orden } from '../src/core/productividad/parseo';

const T0 = Date.UTC(2026, 9, 20, 14) / 1000; // 20 oct 2026, 8:00 en El Salvador
const ord = (id: number, items: number, ini: number, fin: number, nombre = 'JOCELYN YAMILETH URRUTIA BELTRAN', tipo = 'Existencia', zonaTxt = 'ZONA 1'): Orden =>
  [id, nombre, items, +((fin - ini) / 3600).toFixed(4), tipo, '2026-10-20', zonaTxt, T0 + ini, T0 + fin];

describe('Productividad: reglas', () => {
  it('las órdenes que se traslapan cuentan su tiempo una sola vez', () => {
    const a = acum();
    sumar(a, ord(1, 10, 0, 3600));      // 8:00–9:00
    sumar(a, ord(2, 20, 1800, 5400));   // 8:30–9:30 (se traslapa media hora)
    sumar(a, ord(3, 5, 7200, 9000));    // 10:00–10:30
    expect(a.k).toBe(35);
    expect(horas(a)).toBeCloseTo(2, 6);
  });
  it('excluye órdenes de 1 SKU, de menos de 10 s por SKU y de más de 4 h', () => {
    expect(valida(1, 0.5)).toBe(false);
    expect(valida(10, 50 / 3600)).toBe(false);
    expect(valida(10, 4.5)).toBe(false);
    expect(valida(10, 0.5)).toBe(true);
  });
  it('zonas en número y en letras, y tipo de pedido', () => {
    expect(zona('ZONA DOS, ZONA 1').k).toBe('Zona 1 + Zona 2');
    expect(zona('JAULA 1').k).toBe('Jaula 1');
    expect(categoria('VENTA CORPORATIVA-VENTA')).toBe('b2b');
    expect(categoria('VENTA EN LINEA-VENTA,VTA EN LINEA')).toBe('lin');
    expect(categoria('Tienda-Venta')).toBe('ven');
    expect(clave('Urrutia  Beltrán Jocelyn Yamileth')).toBe(clave('JOCELYN YAMILETH URRUTIA BELTRAN'));
  });
  it('la orden cuenta el día en que se empezó a preparar, no el de asignación', () => {
    // asignada el jueves 22 (día que trae la orden) y preparada el viernes 23 a las 7:00 de El Salvador
    const t1 = Date.UTC(2026, 9, 23, 13) / 1000;
    const P = new Productividad([[9, 'JOCELYN YAMILETH URRUTIA BELTRAN', 20, 0.5, 'Existencia', '2026-10-22', 'ZONA 1', t1, t1 + 1800]]);
    expect(P.db.get(9)![5]).toBe('2026-10-23');
  });
  it('SKUs por hora de una persona del listado', () => {
    const P = new Productividad([ord(1, 50, 0, 3600), ord(2, 30, 3600, 5400), ord(3, 1, 6000, 6060)]);
    const V = P.vistaPersonas({ sec: 'retail', flt: 'all', d1: '', d2: '', zsel: '', zAll: false });
    expect(V.filas.length).toBe(1);
    expect(V.filas[0].skus).toBe(80);
    expect(V.filas[0].rate).toBeCloseTo(80 / 1.5, 6);
    expect(V.ex1).toBe(1);
  });
});

describe('Productividad: lectura del rpt_ListaPreparacionAuditoria', () => {
  it('lee la orden y las demás columnas del reporte', () => {
    const serial = (y: number, m: number, d: number, h: number, mi: number) => (Date.UTC(y, m - 1, d, h, mi) / 864e5) + 25569;
    const filas = [
      [null, 'Auditoria lista de preparación'],
      ['ID', 'FECHA PEDIDO', 'DESCRIPCIÓN', 'REVISADO POR', 'TOTAL ITEM', 'UNIDADES', 'TIPO DE PEDIDO', 'ZONA DE PEDIDO', 'FECHA DE ASIGNACIÓN', '1° CODIGO PREPARADO', 'ULTIMO CODIGO PREPARADO', '1° CODIGO REVISADO', 'ULTIMO CODIGO REVISADO', 'ESTADO', 'TIEMPO ASIGNACIÓN', 'TIEMPO PREPARACIÓN', 'TIEMPO DE ESPERA(REVISION)', 'TIEMPO TOTAL', 'TIEMPO REVISIÓN'],
      [914525, serial(2026, 8, 8, 11, 3), 'Preparador: KEVIN JOSUE RAMIREZ CORTEZ ', 'GRACE ZULEYMA RODRIGUEZ CALDERON ', 45, 763, 'Existencia', 'ZONA 2', serial(2026, 8, 8, 11, 3), serial(2026, 8, 8, 11, 9), serial(2026, 8, 8, 11, 50), serial(2026, 8, 8, 13, 54), serial(2026, 8, 8, 14, 3), 'A', 6, 41, 124, 180, 9],
      [999, null, 'Total', null, 3],
    ];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'r');
    const F = leerAuditoria(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(F.length).toBe(1);
    const [id, n, items, h, tipo, dia, z] = F[0].orden;
    expect([id, n, items, h, tipo, dia, z]).toEqual([914525, 'KEVIN JOSUE RAMIREZ CORTEZ', 45, 0.6833, 'Existencia', '2026-08-08', 'ZONA 2']);
    expect(F[0].extra).toMatchObject({ revisador: 'GRACE ZULEYMA RODRIGUEZ CALDERON', unidades: 763, estado: 'A', min_asignacion: 6, min_preparacion: 41, min_espera: 124, min_total: 180, min_revision: 9 });
    expect(F[0].extra.rev2! - F[0].extra.rev1!).toBe(9 * 60);
  });
});
