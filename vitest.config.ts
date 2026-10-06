import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // one file at a time: several PGlite databases in parallel crashed the process on Windows
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: 'test' },
  },
});
