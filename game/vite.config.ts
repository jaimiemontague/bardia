import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Path aliases shared by Vite, Vitest (via mergeConfig) and tsconfig.json `paths`. */
export const aliases = {
  '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
  '@content': fileURLToPath(new URL('./src/content', import.meta.url)),
  '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: aliases },
  // Screenshots and Playwright output are not source: without this the dev server reloads the page
  // every time a test run writes into a results folder.
  server: { port: 5173, strictPort: false, watch: { ignored: ['**/test-results*/**', '**/dist/**', '**/tools/out/**'] } },
  preview: { port: 4173, strictPort: false },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2048,
  },
});
