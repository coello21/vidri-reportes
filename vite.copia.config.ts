import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Plantilla del HTML que se comparte: la misma página en modo "copia" (sin inicio de sesión ni base de datos).
 * PAGINA = app (Radar) o limpieza. scripts/plantilla.mjs la junta en un solo archivo: dist/<PAGINA>/plantilla.html
 */
const pagina = process.env.PAGINA || 'app';
// XLSX_CDN=1 (solo el artefacto): SheetJS 0.18.5 desde cdnjs, el mismo archivo del paquete (misma huella), en vez de adentro.
const XLSX_CDN = process.env.XLSX_CDN === '1';
const SHEETJS = '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" ' +
  'integrity="sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>';
export default defineConfig({
  base: './',
  resolve: XLSX_CDN ? { alias: { xlsx: resolve(import.meta.dirname, 'src/nube/xlsxCdn.ts') } } : {},
  plugins: XLSX_CDN ? [{ name: 'sheetjs-cdn', transformIndexHtml: (h: string) => h.replace('</head>', SHEETJS + '</head>') }] : [],
  publicDir: false,
  build: {
    outDir: 'dist-copia',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: { [pagina]: resolve(import.meta.dirname, pagina + '/index.html') },
      output: { inlineDynamicImports: true },
    },
  },
});
