// Junta dist-copia/<PAGINA>/index.html con su JS y CSS en un solo archivo: dist/<PAGINA>/plantilla.html
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const pagina = process.env.PAGINA || 'app';
const dir = resolve('dist-copia/' + pagina);
let html = readFileSync(resolve(dir, 'index.html'), 'utf8');
const leer = (src) => readFileSync(resolve(dir, src), 'utf8');
// JS: dentro de <script> no puede ir "</script" ni "<!--"
const js = (t) => t.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
let n = 0;
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => { n++; return '<script type="module">' + js(leer(src)) + '</script>'; });
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => { n++; return '<style>' + leer(href) + '</style>'; });
if (!n || /src="\.\/assets|href="\.\/assets|src="\.\.\/assets|href="\.\.\/assets/.test(html)) throw new Error('plantilla: quedaron archivos sin juntar');
writeFileSync(resolve('dist/' + pagina + '/plantilla.html'), html);
rmSync(resolve('dist-copia'), { recursive: true, force: true });
console.log(pagina + '/plantilla.html: ' + Math.round(html.length / 1024) + ' KB');
