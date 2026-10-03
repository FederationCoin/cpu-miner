import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./wallet-mldsa', () => ({
  childSeed: () => new Uint8Array(32),
  keyHash: () => new Uint8Array(32),
  keygen: () => {
    throw new Error('derive failed');
  },
}));

describe('wallet-derive failures', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when ML-DSA keygen fails', async () => {
    const { deriveReceive } = await import('./wallet-derive');
    const seed = new Uint8Array(64);
    expect(() => deriveReceive(seed, 'testnet')).toThrow(/derive failed/);
  });
});
