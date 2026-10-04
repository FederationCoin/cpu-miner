import { describe, expect, it } from 'vitest';
import { childSeed87, keyHash87, keygen87, policyProgram87, sendMultisig87, sendSingleKey87, sign87 } from './wallet-mldsa87';

describe('wallet-mldsa87', () => {
  it('generates 87 keys and a 2-of-3 witness', () => {
    const a = keygen87(childSeed87(new Uint8Array(64).fill(1), 0));
    const b = keygen87(childSeed87(new Uint8Array(64).fill(2), 0));
    const c = keygen87(childSeed87(new Uint8Array(64).fill(3), 0));
    expect(a.publicKey.length).toBe(2592);
    expect(a.secretKey.length).toBe(4896);
    const hashes = [keyHash87(a.publicKey), keyHash87(b.publicKey), keyHash87(c.publicKey)];
    const program = policyProgram87(2, hashes);
    expect(program.length).toBe(32);
    const msg = new Uint8Array(32).fill(7);
    const single = sendSingleKey87(a.publicKey, sign87(msg, a.secretKey));
    expect(single).toHaveLength(2);
    expect(single[1]!.length).toBe(4627);
    const multi = sendMultisig87([
      { pubkey: a.publicKey, signature: sign87(msg, a.secretKey) },
      { pubkey: b.publicKey, signature: sign87(msg, b.secretKey) },
      { keyHash: keyHash87(c.publicKey) },
    ]);
    expect(multi).toHaveLength(5);
    expect(multi[4]).toEqual(keyHash87(c.publicKey));
    const low = new Uint8Array(32);
    const high = new Uint8Array(32);
    high[0] = 1;
    expect(policyProgram87(1, [high, low])).toEqual(policyProgram87(1, [low, high]));
    const tied = new Uint8Array(32).fill(9);
    expect(policyProgram87(1, [tied, tied]).length).toBe(32);
  });
});
