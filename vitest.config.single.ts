import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [process.env.VITEST_FILE ?? 'packages/core/test/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    threads: false,
    pool: 'forks'
  }
});
