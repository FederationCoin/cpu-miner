import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'miner/**/*.test.ts',
      'projects/miner-ui/src/lib/asic-pow.spec.ts',
      'projects/miner-ui/src/lib/stratum-ws.spec.ts',
      'projects/miner-ui/src/lib/web-hasher.spec.ts',
      'projects/miner-ui/src/lib/defaults/defaults.spec.ts',
    ],
    environment: 'node',
  },
});
