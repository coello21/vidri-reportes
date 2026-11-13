/**
 * Uso único (13 nov 2026): recupera el motivo de negado de las líneas cerradas desde el 12-nov, que el ERP dejó sin
 * motivo, con el que traían en revisión (R) en las cargas guardadas en el bucket. No vuelve a contar líneas: solo
 * cambia data.mot de los días y guarda en radar_store la memoria de motivos (motR).
 * Uso: SUPABASE_URL=… SUPABASE_SERVICE_KEY=… TZ=America/El_Salvador npx tsx scripts/recuperar-motivos.ts carpeta-respaldo a.xlsx b.xlsx … (de la más vieja a la más nueva)
 * GUARDAR=1 para guardar; sin eso solo muestra el antes y después (solo números).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { BaseSupabase } from '../src/nube/base';
import { Almacen } from '../src/nube/almacen';
import { CONFIG } from '../src/nube/config';
import { RadarNegados } from '../src/core/negados/radar';
import { recordarMotivos } from '../src/core/negados/motivos';
import { leerExcelNegados } from '../src/core/negados/parseo';
import type { DiaResumen } from '../src/core/negados/tipos';

const url = process.env.SUPABASE_URL, llave = process.env.SUPABASE_SERVICE_KEY;
if (!url || !llave) { console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY'); process.exit(2); }
const [respaldo, ...rutas] = process.argv.slice(2);
if (!rutas.length) { console.error('Faltan los archivos'); process.exit(2); }

const sb = createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const almacen = new Almacen(new BaseSupabase(sb));
const d = await almacen.leer({ diasRadar: CONFIG.DIAS_RADAR, diasPedidos: 1 });
const antes = JSON.parse(JSON.stringify(d.history)), storeAntes = JSON.stringify(d.store);
const radar = new RadarNegados(d.history, d.store);

let ultimo = null as ReturnType<typeof leerExcelNegados> | null;
rutas.forEach((r, i) => {
  const rec = leerExcelNegados(new Uint8Array(readFileSync(r)));
  const n = recordarMotivos(radar.store, rec);
  console.log('archivo ' + (i + 1) + ' de ' + rutas.length + ': ' + rec.length + ' filas, ' + n + ' líneas cerradas con motivo recuperado');
  ultimo = rec;
});
const dias = radar.aplicarMotivosHistorial(ultimo!);

const fila = (mo: any, neg: number) => mo ? 'negadas ' + mo.n + ' de ' + neg + ' · sin motivo ' + (mo.m[''] || 0) + ' · pedidos en cero ' + (mo.z || 0) : 'sin datos';
for (const f of dias.sort()) {
  const neg = (radar.history[f] as DiaResumen).meta?.totalNegados || 0;
  console.log(f + '\n  antes:   ' + fila((antes[f] as DiaResumen)?.mot, neg) + '\n  después: ' + fila((radar.history[f] as DiaResumen).mot, neg));
  const a = antes[f] as DiaResumen, b = radar.history[f] as DiaResumen;
  const sinMot = (x: DiaResumen) => JSON.stringify({ ...x, mot: undefined });
  if (sinMot(a) !== sinMot(b)) console.log('  ¡cambió algo fuera del motivo!');
}
const S = radar.store as any;
console.log('memoria de motivos (motR): ' + JSON.stringify(S.motR || {}).length + ' bytes');

if (process.env.GUARDAR === '1') {
  mkdirSync(respaldo, { recursive: true });
  writeFileSync(respaldo + '/radar_store.json', storeAntes);
  writeFileSync(respaldo + '/radar_dias.json', JSON.stringify(Object.fromEntries(dias.map((f) => [f, antes[f]]))));
  const g = await almacen.guardar({ history: radar.history, store: radar.store }, 'recuperar-motivos');
  console.log('Guardado: ' + g.dias + ' días' + (g.catalogo ? ' y la memoria de motivos' : ''));
} else console.log('Solo vista previa: no se guardó nada.');
