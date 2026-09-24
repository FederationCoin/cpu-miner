import { describe, expect, it } from 'vitest';
import { createPhrase, derivePrivateKey, deriveReceive, isValidPhrase, phraseWordCount, seedFromPhrase } from './wallet-derive';

const TWELVE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('wallet-derive', () => {
  it('creates 12 and 24 word English phrases', () => {
    const a = createPhrase(128);
    const b = createPhrase(256);
    expect(phraseWordCount(a)).toBe(12);
    expect(phraseWordCount(b)).toBe(24);
    expect(isValidPhrase(a)).toBe(true);
    expect(isValidPhrase(b)).toBe(true);
    expect(isValidPhrase('not a phrase')).toBe(false);
    expect(phraseWordCount('one two')).toBeNull();
  });

  it('derives native-segwit receive addresses per chain HRP', () => {
    const seed = seedFromPhrase(TWELVE);
    expect(deriveReceive(seed, 'testnet')).toMatch(/^tgfcn1/);
    expect(deriveReceive(seed, 'main')).toMatch(/^gfcn1/);
    expect(deriveReceive(seed, 'testnet')).not.toBe(deriveReceive(seed, 'main'));
    expect(derivePrivateKey(seed, 'testnet').length).toBe(32);
    expect(derivePrivateKey(seed, 'main').length).toBe(32);
  });
});
