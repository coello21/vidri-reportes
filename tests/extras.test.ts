import { describe, it, expect } from 'vitest';
import { contarRevision, lineasPreparadas, fotoSinActualizar, sinActualizarPorCodigo } from '../src/core/negados/extras';
import type { Registro, StoreRadar } from '../src/core/negados/tipos';

const D = (s: string) => new Date(s);
const rec = (ped: number, sku: string, rev: string | null, est = 'P', extra: Partial<Registro> = {}): Registro => ({
  Pedido: String(ped), SKU: sku, Estado: est, FechaRevision: rev ? D(rev) : null, FechaAct: null, Fecha: D('2026-10-20T08:00:00'),
  Sucursal: 'LOURDES', Orden: 'O' + ped, Preparador: 'P', Cantidad: 2, CantPrep: 1, Disponible: 5, Desc: 'd', Categoria: 'c', ...extra,
});
const conCorte = (r: Registro, f: string) => ({ ...r, Fecha: D(f) });

describe('Líneas preparadas (Fecha Enviado Revisión)', () => {
  it('cuenta una vez entre cargas, mueve y quita líneas, y no deja que un Excel viejo las regrese', () => {
    const st = {} as StoreRadar;
    const c12 = () => [rec(1, 'a', '2026-10-20T10:00:00'), rec(1, 'b', '2026-10-20T11:00:00'), rec(2, 'a', '2026-10-20T11:30:00'), rec(3, 'a', null), conCorte(rec(9, 'z', '2026-10-20T11:59:00'), '2026-10-20T12:00:00')];
    contarRevision(st, c12(), 10);
    expect(lineasPreparadas(st, '2026-10-20', '2026-10-20')).toBe(4);
    contarRevision(st, [rec(1, 'a', '2026-10-20T10:00:00', 'A'), rec(1, 'b', '2026-10-20T11:00:00'), rec(2, 'a', '2026-10-20T11:30:00'), rec(3, 'a', '2026-10-20T15:00:00'), conCorte(rec(9, 'z', '2026-10-20T11:59:00'), '2026-10-20T16:00:00')], 10);
    expect(lineasPreparadas(st, '2026-10-20', '2026-10-20')).toBe(5);
    contarRevision(st, [rec(1, 'a', '2026-10-20T10:00:00', 'A'), rec(1, 'b', '2026-10-21T08:00:00'), rec(2, 'a', null), rec(3, 'a', '2026-10-20T15:00:00'), conCorte(rec(9, 'z', '2026-10-20T11:59:00'), '2026-10-21T09:00:00')], 10);
    expect(lineasPreparadas(st, '2026-10-20', '2026-10-20')).toBe(3);
    expect(lineasPreparadas(st, '2026-10-21', '2026-10-21')).toBe(1);
    contarRevision(st, c12(), 10);
    contarRevision(st, c12(), 10);
    expect(lineasPreparadas(st, '2026-10-20', '2026-10-21')).toBe(4);
    expect(lineasPreparadas(st, '2026-10-01', '2026-10-05')).toBeNull();
  });

  it('borra el detalle de los días viejos pero conserva el total', () => {
    const st = {} as StoreRadar;
    contarRevision(st, [conCorte(rec(1, 'a', '2026-10-01T10:00:00'), '2026-10-01T12:00:00')], 10);
    contarRevision(st, [conCorte(rec(2, 'a', '2026-10-20T10:00:00'), '2026-10-20T12:00:00')], 10);
    const S = st as StoreRadar & { revK: Record<string, string>; revN: Record<string, number> };
    expect(Object.keys(S.revK)).toEqual(['2026-10-20']);
    expect(S.revN).toEqual({ '2026-10-01': 1, '2026-10-20': 1 });
  });
});

describe('Negados sin actualizar', () => {
  it('toma las líneas mandadas a revisión en 0 y sin cerrar, y agrupa por código', () => {
    const st = {} as StoreRadar;
    const rows = [
      rec(1, 'x', '2026-10-20T10:00:00', 'R', { CantPrep: 0, Disponible: 8, Cantidad: 3, Ubic1: 'A-01' }),
      rec(2, 'x', '2026-10-20T11:00:00', 'R', { CantPrep: 0, Disponible: 8, Cantidad: 2, Ubic1: 'A-01', Sucursal: 'MERLIOT' }),
      rec(3, 'y', '2026-10-20T11:00:00', 'R', { CantPrep: 0, Disponible: 0 }),           // sin existencia: no sale
      rec(4, 'z', '2026-10-20T11:00:00', 'A', { CantPrep: 0, FechaAct: D('2026-10-20T12:00:00') }), // ya cerrada
      rec(5, 'w', null, 'P', { CantPrep: 0 }),                                           // no se mandó a revisión
    ];
    expect(fotoSinActualizar(st, rows)).toBe(true);
    const r = sinActualizarPorCodigo(st)!;
    expect(r.codigos.map((c) => [c.sku, c.n, c.q, c.pedidos, c.suc.sort().join(',')])).toEqual([['x', 2, 5, 2, 'LOURDES,MERLIOT']]);
    // un Excel más viejo no reemplaza la foto
    expect(fotoSinActualizar(st, [rec(9, 'q', '2026-10-19T10:00:00', 'R', { CantPrep: 0, Fecha: D('2026-10-19T08:00:00') })])).toBe(false);
  });
});
