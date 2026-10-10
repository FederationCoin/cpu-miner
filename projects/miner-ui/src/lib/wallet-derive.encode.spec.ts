import { describe, expect, it, vi } from 'vitest';

vi.mock('./wallet-bech32', () => ({
  encodeAddress: () => null,
}));

const TWELVE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('wallet-derive encode failure', () => {
  it('throws when address encoding fails', async () => {
    const { deriveReceive, seedFromPhrase } = await import('./wallet-derive');
    expect(() => deriveReceive(seedFromPhrase(TWELVE), 'testnet')).toThrow(/encode failed/);
  });
});
