import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@scure/bip32', () => ({
  HDKey: {
    fromMasterSeed: () => ({
      derive: () => ({}),
    }),
  },
}));

describe('wallet-derive failures', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when HD derive omits keys', async () => {
    const { deriveReceive, derivePrivateKey } = await import('./wallet-derive');
    const seed = new Uint8Array(64);
    expect(() => deriveReceive(seed, 'testnet')).toThrow(/derive failed/);
    expect(() => derivePrivateKey(seed, 'testnet')).toThrow(/derive failed/);
  });
});
