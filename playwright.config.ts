import { defineConfig, devices } from '@playwright/test';

/**
 * Headless smoke test against a prebuilt `dist` (via `vite preview`). Exists
 * specifically to catch the two worst historical bugs: the entry-chunk
 * top-level-await deadlock (black screen, render loop never starts) and
 * silent WebGPU/WebGL black frames. SwiftShader on CI runners is flaky, so
 * this stays single-worker with retries and avgFps-based waits (no sleeps).
 */
export default defineConfig({
  testDir: 'tests/smoke',
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:4173/small-vibrations/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: {
    // Serves the prebuilt dist/ — CI runs `npm run build` first.
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/small-vibrations/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
});
