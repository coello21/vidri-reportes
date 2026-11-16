/**
 * Vista previa (y guardado con GUARDAR=1) de la regla de revisión desde el 12-nov con las cargas guardadas en el bucket.
 * Corre el mismo cálculo de cada carga (procesarRpt) con la carga más nueva y las anteriores como "previos".
 * Uso: … npx tsx scripts/vista-revision.ts carpeta-respaldo previa1.xlsx … nueva.xlsx   (de la más vieja a la más nueva)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { BaseSupabase } from '../src/nube/base';
import { Almacen } from '../src/nube/almacen';
import { CONFIG } from '../src/nube/config';
import { RadarNegados } from '../src/core/negados/radar';
import { PedidosCD } from '../src/core/pedidos/cd';
import { procesarRpt } from '../src/app/cargaRpt';
import { fillRateCD } from '../src/core/negados/motivos';
import { DESDE_REVISION } from '../src/core/negados/revision';
import type { DiaResumen, Historial } from '../src/core/negados/tipos';

const url = process.env.SUPABASE_URL, llave = process.env.SUPABASE_SERVICE_KEY;
if (!url || !llave) { console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY'); process.exit(2); }
const [respaldo, ...rutas] = process.argv.slice(2);
const A = (r: string) => ({ nombre: basename(r), buf: new Uint8Array(readFileSync(r)) });
const sb = createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const almacen = new Almacen(new BaseSupabase(sb));
const d = await almacen.leer({ diasRadar: CONFIG.DIAS_RADAR, diasPedidos: CONFIG.DIAS_PEDIDOS });
const antes: Historial = JSON.parse(JSON.stringify(d.history));
const radar = new RadarNegados(d.history, d.store), pedidos = new PedidosCD(d.pedidos);
const r = procesarRpt(radar, pedidos, [A(rutas[rutas.length - 1])], rutas.slice(0, -1).map(A));
console.log(r.partes.filter((p) => p.startsWith('desde el 12-nov')).join(''));
const fila = (H: Historial, f: string) => {
  const h = H[f] as DiaResumen | undefined;
  if (!h?.meta) return 'sin datos';
  const fr = fillRateCD(H, [f]);
  return 'preparadas ' + h.meta.totalPreparados + ' · negadas ' + h.meta.totalNegados + ' · pedidos en cero ' + (h.mot?.z || 0) + ' · fill rate ' + (fr.pct == null ? '—' : fr.pct.toFixed(1) + ' %') + ' · sin motivo ' + (h.mot?.m?.[''] || 0);
};
for (const f of [...new Set([...Object.keys(antes), ...Object.keys(radar.history)])].filter((x) => x >= DESDE_REVISION).sort())
  console.log(f + '\n  antes:   ' + fila(antes, f) + '\n  después: ' + fila(radar.history, f));
if (process.env.GUARDAR === '1') {
  mkdirSync(respaldo, { recursive: true });
  writeFileSync(respaldo + '/radar_dias.json', JSON.stringify(Object.fromEntries(Object.keys(antes).filter((x) => x >= DESDE_REVISION).map((x) => [x, antes[x]]))));
  radar.persistSeen(); pedidos.podarAsignaciones();
  const g = await almacen.guardar({ history: radar.history, store: radar.store, pedidos: { rows: [...pedidos.rows.values()], cortes: pedidos.cortes, asgP: pedidos.asgP } }, 'regla-revision');
  console.log('Guardado: ' + g.dias + ' días');
} else console.log('Solo vista previa: no se guardó nada.');
