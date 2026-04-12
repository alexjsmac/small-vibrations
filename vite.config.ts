import { defineConfig } from 'vite';

export default defineConfig({
  base: '/small-vibrations/',
  server: { port: 5173 },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
