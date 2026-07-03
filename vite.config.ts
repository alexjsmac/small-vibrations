import { defineConfig } from 'vite';

export default defineConfig({
  base: '/small-vibrations/',
  server: { port: 5173 },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep three out of the entry chunk so per-track viz chunks import it
        // from a leaf chunk instead of circularly from the entry.
        manualChunks: { three: ['three'] },
      },
    },
  },
});
