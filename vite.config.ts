import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base = nombre del repositorio en GitHub Pages (https://usuario.github.io/vidri-reportes/)
export default defineConfig({
  base: process.env.VITE_BASE ?? '/vidri-reportes/',
  build: {
    rollupOptions: {
      input: {
        inicio: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
      },
    },
  },
});
