import { describe, expect, it } from 'vitest';
import { parseBlob, phrasesEqual, unwrapSeed, wrapSeed, fingerprint } from './wallet-crypto';

describe('wallet-crypto', () => {
  it('normalizes phrases for equality', () => {
    expect(phrasesEqual('  Alpha Beta  ', 'alpha beta')).toBe(true);
    expect(phrasesEqual('alpha', 'beta')).toBe(false);
  });

  it('wraps and unwraps a seed and rejects a wrong password', async () => {
    const seed = new Uint8Array(64).fill(7);
    const blob = await wrapSeed(seed, 'correct horse', 'tgfcn1qqq');
    expect(blob.kdf).toBe('argon2id');
    expect(blob.v).toBe(1);
    const out = await unwrapSeed(blob, 'correct horse');
    expect([...out]).toEqual([...seed]);
    expect(fingerprint(seed)).toHaveLength(16);
    await expect(unwrapSeed(blob, 'wrong')).rejects.toThrow(/wrong password/);
  });

  it('parseBlob accepts a wrapped blob and rejects junk', async () => {
    const blob = await wrapSeed(new Uint8Array(64), 'pw', 'tgfcn1qqq');
    expect(parseBlob(JSON.stringify(blob))?.receive).toBe('tgfcn1qqq');
    expect(parseBlob('{')).toBeNull();
    expect(parseBlob(JSON.stringify({ ...blob, v: 2 }))).toBeNull();
    expect(parseBlob(JSON.stringify({ ...blob, receive: '' }))).toBeNull();
    await expect(unwrapSeed({ ...blob, kdf: 'scrypt' } as unknown as typeof blob, 'pw')).rejects.toThrow(/unsupported/);
  });
});
