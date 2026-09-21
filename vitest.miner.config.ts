import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'miner/**/*.test.ts',
      'projects/miner-ui/src/lib/asic-pow.spec.ts',
      'projects/miner-ui/src/lib/stratum-ws.spec.ts',
      'projects/miner-ui/src/lib/web-hasher.spec.ts',
      'projects/miner-ui/src/lib/defaults/defaults.spec.ts',
      'projects/miner-ui/src/lib/registry.spec.ts',
      'projects/miner-ui/src/lib/mine-target.spec.ts',
      'projects/miner-ui/src/lib/wallet-crypto.spec.ts',
      'projects/miner-ui/src/lib/wallet-derive.spec.ts',
      'projects/miner-ui/src/lib/wallet-derive.fail.spec.ts',
      'projects/miner-ui/src/lib/wallet-derive.encode.spec.ts',
      'projects/miner-ui/src/lib/electrum-sign.spec.ts',
      'projects/miner-ui/src/lib/finder-sign.spec.ts',
      'projects/miner-ui/src/lib/radar-frame.spec.ts',
    ],
    environment: 'node',
    coverage: {
      enabled: true,
      include: [
        'miner/extras.ts',
        'miner/node-process.ts',
        'miner/gateway-process.ts',
        'miner/wallet-store.ts',
        'projects/miner-ui/src/lib/wallet-crypto.ts',
        'projects/miner-ui/src/lib/wallet-derive.ts',
        'projects/miner-ui/src/lib/electrum-sign.ts',
        'projects/miner-ui/src/lib/finder-sign.ts',
        'projects/miner-ui/src/lib/radar-frame.ts',
      ],
      thresholds: {
        branches: 90,
        lines: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
