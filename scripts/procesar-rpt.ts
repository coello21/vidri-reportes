/**
 * Pipeline: procesa uno o varios Rpt_OrdenesPreparacion contra Supabase con el mismo cálculo de la página.
 * Uso: SUPABASE_URL=… SUPABASE_SERVICE_KEY=… TZ=America/El_Salvador npx tsx scripts/procesar-rpt.ts archivo.xlsx [...]
 * Imprime en la última línea un JSON {mensaje, resumen} (solo números; nunca datos de la empresa).
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { BaseSupabase } from '../src/nube/base';
import { procesarRptEnBase } from '../src/nube/rptBase';

const url = process.env.SUPABASE_URL, llave = process.env.SUPABASE_SERVICE_KEY;
if (!url || !llave) { console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY'); process.exit(2); }
const rutas = process.argv.slice(2);
if (!rutas.length) { console.error('Falta el archivo'); process.exit(2); }

const sb = createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const archivos = rutas.map((r) => ({ nombre: basename(r), buf: new Uint8Array(readFileSync(r)) }));
const r = await procesarRptEnBase(new BaseSupabase(sb), archivos);
const g = r.guardado;
const mensaje = 'Cargado: ' + r.partes.join(' · ') + (r.avisos.length ? ' · ' + r.avisos.join(' · ') : '') +
  (g.dias || g.pedidos || g.catalogo || g.cortes ? ' · Guardado en la base.' : ' · La base ya estaba al día.');
console.log(JSON.stringify({ mensaje, resumen: { dias: g.dias, pedidos: g.pedidos, catalogo: g.catalogo, cortes: g.cortes, destino: r.destino, con_error: r.conError } }));
