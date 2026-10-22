import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Plantilla del HTML que se comparte: la misma página en modo "copia" (sin inicio de sesión ni base de datos).
 * PAGINA = app (Radar) o productividad. scripts/plantilla.mjs la junta en un solo archivo: dist/<PAGINA>/plantilla.html
 */
const pagina = process.env.PAGINA || 'app';
export default defineConfig({
  base: './',
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
