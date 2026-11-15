import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the production build (vite preview) with the locally
 * installed Google Chrome (channel 'chrome'), so no browser download is needed.
 *
 * Parallel agents sharing this folder must not rebuild `dist/` or fight over port 4173. They run
 * their own dev server and point the tests at it:
 *   BARDIA_E2E_URL=http://localhost:5181  — use this server; do not build or start one
 *   BARDIA_E2E_OUT=test-results-hub       — Playwright's output folder (it is wiped at the start of a run)
 */
const externalUrl = process.env.BARDIA_E2E_URL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  outputDir: process.env.BARDIA_E2E_OUT ?? 'test-results',
  use: {
    baseURL: externalUrl ?? 'http://localhost:4173',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  ...(externalUrl === undefined
    ? {
        webServer: {
          command: 'npm run build && npm run preview -- --port 4173 --strictPort',
          url: 'http://localhost:4173',
          reuseExistingServer: true,
          timeout: 180_000,
        },
      }
    : {}),
});
