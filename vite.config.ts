import { defineConfig } from 'vite';

// base = nombre del repositorio en GitHub Pages (https://usuario.github.io/vidri-reportes/)
export default defineConfig({
  base: process.env.VITE_BASE ?? '/vidri-reportes/',
});
