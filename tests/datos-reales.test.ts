/**
 * Con los datos reales de un día, la versión TypeScript debe dar los mismos números que
 * mostraba el tablero ese día.
 * Los datos y los números esperados son información de la empresa: viven solo en tu
 * computadora (tests/fixtures/*.local.*) y NO se suben al repositorio. Si no están, se salta.
 *   radar-AAAA-MM-DD.local.json.gz          datos (node scripts/fixture-desde-html.mjs ...)
 *   radar-AAAA-MM-DD.esperado.local.json    lo que mostraba el tablero ese día
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { RadarNegados, PedidosCD } from '../src/core';

const DIA = '2026-10-19';
const ruta = (n: string) => fileURLToPath(new URL('./fixtures/' + n, import.meta.url));
const fDatos = ruta(`radar-${DIA}.local.json.gz`), fEsp = ruta(`radar-${DIA}.esperado.local.json`);
const hay = existsSync(fDatos) && existsSync(fEsp);
const datos = hay ? JSON.parse(gunzipSync(readFileSync(fDatos)).toString('utf8')) : null;
const E = hay ? JSON.parse(readFileSync(fEsp, 'utf8')) : null;
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

describe.skipIf(!hay)(`Datos reales del ${DIA}`, () => {
  const radar = new RadarNegados(datos?.history, datos?.store);
  const ped = new PedidosCD(datos?.pedidos);

  it('negados del día (corte parcial)', () => {
    const e = E.l19, vm = radar.agregado(DIA, DIA)!;
    expect([vm.meta.totalFinal, vm.meta.totalNegados, r1(vm.meta.pct)]).toEqual([e.totalFinal, e.totalNegados, e.pct]);
    expect(vm.bucketCounts).toEqual(e.bucket);
    expect([vm.meta.exactas, vm.meta.prepEval, r1(radar.exactitud(vm))]).toEqual([e.exactas, e.prepEval, e.exactitud]);
    expect(vm.byStore[0]).toEqual(e.store0);
    expect(vm.byStore[1]).toEqual(e.store1);
    expect([vm.topCodes[0].sku, vm.topCodes[0].count]).toEqual(e.top0);
    expect(radar.isPartialDay(DIA)).toBe(true);
    const b = radar.fillRateB2B(DIA, DIA);
    expect([b.ok, b.tot, r1(b.pct)]).toEqual(e.b2b);
  });

  it('negados de días completos anteriores', () => {
    for (const [k, d] of [['l12', '2026-10-12'], ['s17', '2026-10-17']] as const) {
      const vm = radar.agregado(d, d)!;
      expect([vm.meta.totalFinal, vm.meta.totalNegados, vm.meta.exactas, vm.meta.prepEval]).toEqual(E[k].m);
      const b = radar.fillRateB2B(d, d);
      expect([b.ok, b.tot]).toEqual(E[k].b2b);
    }
    const l12 = radar.agregado('2026-10-12', '2026-10-12')!;
    expect([l12.bucketCounts.positivo, l12.bucketCounts.cero + l12.bucketCounts.negativo]).toEqual(E.l12.b);
  });

  it('pedidos: balance de los últimos 15 días', () => {
    expect(ped.balance().map((r) => [r.d, r.ini, r.ent, r.ter, r.fin])).toEqual(E.balance);
    const hoy = ped.balance().at(-1)!;
    expect(hoy.cur).toBe(true);
    expect(hoy.sa1).toBe(E.sa1);
  });

  it('pedidos: avance de lo que cayó el día', () => {
    const a = ped.avance(DIA);
    expect([a.n, a.sinEmpezar, a.enProceso, a.terminados]).toEqual(E.avance);
    expect([a.quedan, a.quedabanSemanaPasada]).toEqual(E.quedan);
  });

  it('pedidos: pendientes al último corte', () => {
    expect(ped.pendientes(['R']).ok.length).toBe(E.pendR);
    expect(ped.pendientes(['P']).ok.length).toBe(E.pendP);
    const p = ped.pendienteSinAsignar();
    expect(p.skus).toBe(E.skus);
    expect(p.tramos.map((t) => t.skus)).toEqual(E.tramos);
    expect(p.porMotivo).toEqual(E.porMotivo);
    const t = ped.tablaPendientes(['R']);
    expect(t.total).toBe(E.tabla.total);
    expect(t.totalDia['2026-10-16']).toBe(E.tabla['2026-10-16']);
    expect(t.totalDia[DIA]).toBe(E.tabla[DIA]);
  });

  it('pedidos: asignados y sucursales en la ventana', () => {
    const a = ped.asignadosPorDia()!;
    expect([a.pedidos.at(-1), a.skus.at(-1)]).toEqual(E.asig);
    const P = ped.periodo()!;
    expect(PedidosCD.arrastre(P.all, P.days).skus.at(-1)).toBe(E.arrastreSkus);
    const s = ped.sucursales();
    expect([s.reduce((x, r) => x + r.pedidos, 0), s.reduce((x, r) => x + r.skus, 0)]).toEqual(E.suc);
    expect(s[0]).toMatchObject(E.suc0);
  });
});
