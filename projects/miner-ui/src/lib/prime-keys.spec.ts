import { describe, expect, it } from 'vitest';
import { applyFetchedIdentity, identityPubkeyFromKeysDocument } from './prime-keys';

describe('prime keys document', () => {
  const ed = 'ab'.repeat(32);
  const x = 'cd'.repeat(32);

  it('joins the two public halves and rejects a bad document', () => {
    expect(identityPubkeyFromKeysDocument({ ed25519: ed.toUpperCase(), x25519: x })).toBe(ed + x);
    expect(identityPubkeyFromKeysDocument(null)).toBeNull();
    expect(identityPubkeyFromKeysDocument({ ed25519: 'aa', x25519: x })).toBeNull();
    expect(identityPubkeyFromKeysDocument({ ed25519: ed })).toBeNull();
  });

  it('does not overwrite a pin that disagrees with the fetch', () => {
    expect(applyFetchedIdentity('', ed + x)).toEqual({ pubkey: ed + x, mismatch: false });
    expect(applyFetchedIdentity(ed + x, ed + x)).toEqual({ pubkey: ed + x, mismatch: false });
    expect(applyFetchedIdentity('11'.repeat(64), ed + x)).toEqual({ pubkey: '11'.repeat(64), mismatch: true });
    expect(applyFetchedIdentity('', 'nope').mismatch).toBe(true);
  });
});
