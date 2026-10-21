import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Plantilla del HTML que se comparte: la misma página de /app/ en modo "copia"
 * (sin inicio de sesión ni base de datos). scripts/plantilla.mjs la junta en un solo archivo
 * y la deja en dist/app/plantilla.html.
 */
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
      input: { app: resolve(__dirname, 'app/index.html') },
      output: { inlineDynamicImports: true },
    },
  },
});
