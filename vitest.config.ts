import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node', // QualityManager test opts into jsdom per-file via a docblock
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
