import { describe, expect, it } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import { MESSAGE_MAGIC, magicHash, signElectrum } from './electrum-sign';
import { childSeed } from './wallet-mldsa';

const TWELVE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('electrum-sign', () => {
  it('uses FederationCoin magic and an ML-DSA-44 signature', () => {
    expect(MESSAGE_MAGIC).toBe('FederationCoin Signed Message:\n');
    const seed = mnemonicToSeedSync(TWELVE);
    const child = childSeed(seed, 0);
    const sig = signElectrum('ab'.repeat(32), child);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(atob(sig).length).toBe(2420);
    expect(magicHash('hi').length).toBeGreaterThan(32);
    expect(() => signElectrum('x'.repeat(300), child)).toThrow(/too long/);
  });
});
