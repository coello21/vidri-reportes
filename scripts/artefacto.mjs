// Radar como artefacto de Claude: un solo archivo HTML que lee Supabase por el conector (solo lectura).
// Lleva adentro la plantilla de la copia (gzip + base64) para «Descargar HTML».
// Uso: node scripts/artefacto.mjs  →  dist-artefacto/Radar_de_Preparacion.html
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const sh = (c, env = {}) => execSync(c, { stdio: 'inherit', env: { ...process.env, ...env } });
const css = readFileSync('public/nube/tema.css', 'utf8');
const tema = readFileSync('public/nube/tema.js', 'utf8').replace(/<\/script/gi, '<\\/script');
// diseño adentro y sin el reporte ejecutivo (igual que plantillaEnLinea en la página)
const juntar = (h) => h
  .replace(/<link[^>]*href="\.\.\/nube\/tema\.css"[^>]*>/, () => '<style id="tema-css">' + css + '</style>')
  .replace(/<script[^>]*src="\.\.\/nube\/tema\.js"[^>]*><\/script>/, () => '<script>' + tema + '</script>')
  .replace(/<script[^>]*src="\.\.\/nube\/reporte\.js"[^>]*><\/script>/, '');

mkdirSync('dist-artefacto', { recursive: true });
sh('npx vite build --config vite.copia.config.ts --mode copia --logLevel error', { PAGINA: 'app' });
sh('node scripts/plantilla.mjs', { PAGINA: 'app', SALIDA: 'dist-artefacto/.copia.html' });
const copia = juntar(readFileSync('dist-artefacto/.copia.html', 'utf8'));

sh('npx vite build --config vite.copia.config.ts --mode artefacto --logLevel error', { PAGINA: 'app' });
sh('node scripts/plantilla.mjs', { PAGINA: 'app', SALIDA: 'dist-artefacto/.artefacto.html' });
let html = juntar(readFileSync('dist-artefacto/.artefacto.html', 'utf8'));
if (/\.\.\/nube\//.test(html) || /\.\.\/nube\//.test(copia)) throw new Error('quedó un archivo de ../nube sin juntar');
const b64 = gzipSync(Buffer.from(copia)).toString('base64');
const k = html.toLowerCase().lastIndexOf('</body>');
html = html.slice(0, k) + '<script type="text/plain" id="plantilla-copia">' + b64 + '</script>' + html.slice(k);
writeFileSync('dist-artefacto/Radar_de_Preparacion.html', html);
console.log('dist-artefacto/Radar_de_Preparacion.html: ' + Math.round(html.length / 1024) + ' KB');
