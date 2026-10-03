import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
