import { describe, expect, it } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { MESSAGE_MAGIC, magicHash, signElectrum } from './electrum-sign';

const TWELVE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('electrum-sign', () => {
  it('uses FederationCoin Electrum Format magic and a compact recoverable signature', () => {
    expect(MESSAGE_MAGIC).toBe('FederationCoin Signed Message:\n');
    const seed = mnemonicToSeedSync(TWELVE);
    const hd = HDKey.fromMasterSeed(seed).derive("m/84'/1'/0'/0/0");
    const sig = signElectrum('ab'.repeat(32), hd.privateKey!);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(atob(sig).length).toBe(65);
    expect(magicHash('hi').length).toBe(32);
    expect(() => signElectrum('x'.repeat(300), hd.privateKey!)).toThrow(/too long/);
  });
});
