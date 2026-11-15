import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tools/**/*.test.ts'],
      exclude: ['node_modules', 'dist', 'tests/e2e/**'],
      coverage: {
        provider: 'v8',
        include: ['src/sim/**/*.ts', 'src/content/**/*.ts'],
        exclude: ['**/*.test.ts'],
        reporter: ['text', 'html'],
      },
    },
  }),
);
