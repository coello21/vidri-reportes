// Saca los datos incrustados de un HTML del Radar (botón "Descargar HTML") y los guarda
// como archivo de prueba local: tests/fixtures/radar-AAAA-MM-DD.local.json.gz
// Uso:  node scripts/fixture-desde-html.mjs "C:/ruta/Radar_de_Negados_2026-10-19.html"
// El archivo .local NO se sube al repositorio (.gitignore): es información de la empresa.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

const ruta = process.argv[2];
if (!ruta) { console.error('Indica la ruta del HTML.'); process.exit(1); }
const html = readFileSync(ruta, 'utf8');
const m = /id="emb">([^<]+)</.exec(html);
if (!m || m[1].trim() === '[EMB]') { console.error('Ese HTML no trae datos incrustados.'); process.exit(1); }
const json = gunzipSync(Buffer.from(m[1].trim(), 'base64'));
const fecha = (/Radar_de_Negados_(\d{4}-\d{2}-\d{2})/.exec(ruta) || [])[1] || new Date().toISOString().slice(0, 10);
const destino = `tests/fixtures/radar-${fecha}.local.json.gz`;
writeFileSync(destino, gzipSync(json));
console.log('Guardado', destino);
