import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['miner/**/*.test.ts'],
    environment: 'node',
  },
});
