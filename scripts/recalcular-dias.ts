/**
 * Uso único (19-nov-2026): recalcula los días del Radar con las reglas de Nejapa (sin zonas que no son de Nejapa y
 * duplicados solo por Pedido + SKU) desde los Rpt_OrdenesPreparacion originales, con el mismo código de la página.
 * Uso: TZ=America/El_Salvador npx tsx scripts/recalcular-dias.ts SALIDA_DIR archivo1.xlsx archivo2.xlsx ...
 * Escribe SALIDA_DIR/dias.json.gz (días DESDE..) y SALIDA_DIR/revN.json. Solo imprime fechas y conteos.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { RadarNegados } from '../src/core/negados/radar';
import { leerExcelNegados } from '../src/core/negados/parseo';
import { contarRevision } from '../src/core/negados/extras';
import { recordarMotivos } from '../src/core/negados/motivos';
import { rehacerDesdeRevision, DESDE_REVISION } from '../src/core/negados/revision';
import type { Historial, Registro } from '../src/core/negados/tipos';

const DESDE = '2026-10-01';
const [salida, ...rutas] = process.argv.slice(2);
const ms = (x?: Date | null) => (x ? x.getTime() : 0);
const archivos = rutas.map((r) => {
  const recs: Registro[] = leerExcelNegados(new Uint8Array(readFileSync(r)));
  let c = 0, f0 = Infinity; recs.forEach((x) => { c = Math.max(c, ms(x.FechaAct), ms(x.FechaRevision), ms(x.Fecha)); if (x.Fecha) f0 = Math.min(f0, ms(x.Fecha)); });
  return { r, recs, c, f0 };
}).sort((a, b) => a.f0 - b.f0 || a.c - b.c); // en el orden de las fechas de creación (como se fueron cargando)
const radar = new RadarNegados({}, null);
for (const { r, recs, c } of archivos) {
  recordarMotivos(radar.store, recs);
  contarRevision(radar.store, recs, 90); // ventana amplia: los archivos semanales se traslapan
  const res = radar.cargarRegistros(recs);
  console.log(new Date(c).toISOString().slice(0, 16), r.split('/').pop(), recs.length, 'filas ·', res.added, 'líneas nuevas');
}
const antes: Historial = {};
for (const d of Object.keys(radar.history)) if (d >= DESDE_REVISION) antes[d] = JSON.parse(JSON.stringify(radar.history[d]));
const desdeNov = archivos.filter((a) => a.c >= new Date('2026-11-11T00:00:00').getTime()).map((a) => a.recs);
console.log('rehechos con la regla de revisión:', rehacerDesdeRevision(radar, antes, desdeNov).join(', '));
const dias: Record<string, unknown> = {};
for (const d of Object.keys(radar.history).sort()) if (d >= DESDE) dias[d] = radar.history[d];
writeFileSync(salida + '/dias.json.gz', gzipSync(JSON.stringify(dias)));
const revN: Record<string, number> = {};
for (const [d, n] of Object.entries(radar.store.revN || {})) if (d >= DESDE) revN[d] = n as number;
writeFileSync(salida + '/revN.json', JSON.stringify(revN));
// llaves de los últimos 10 días (como las guarda la página) para que las próximas cargas no cuenten doble
const S = radar.store as any, kd = Object.keys(S.revK || {}).sort(), lim = kd.length ? kd[kd.length - 1] : '';
const corta = (o: Record<string, string> = {}) => { const r: Record<string, string> = {}; const keep = lim ? new Date(new Date(lim + 'T12:00:00').getTime() - 10 * 864e5).toISOString().slice(0, 10) : ''; for (const d in o) if (d >= keep) r[d] = o[d]; return r; };
writeFileSync(salida + '/rev_store.json', JSON.stringify({ revK: corta(S.revK), revX: corta(S.revX), revKT: S.revKT }));
for (const d of Object.keys(dias)) { const m = (dias[d] as any).meta; console.log(d, m.totalFinal, m.totalPreparados, m.totalNegados, revN[d] ?? '-'); }
