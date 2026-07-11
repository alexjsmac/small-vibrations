import { defineConfig } from 'vite';

export default defineConfig({
  // Served under /small-vibrations/ on Pages. PR previews override this to
  // /small-vibrations/pr-preview/pr-<N>/ via BASE_PATH so every asset,
  // the fingerprint DB, and the audio worklet (all resolved off
  // import.meta.env.BASE_URL) load from the preview subpath, not the root.
  base: process.env.BASE_PATH || '/small-vibrations/',
  server: { port: Number(process.env.PORT) || 5173 },
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
