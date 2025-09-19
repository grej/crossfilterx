import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    threads: false,
    pool: 'forks'
  }
});
