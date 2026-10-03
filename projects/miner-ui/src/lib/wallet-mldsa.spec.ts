import { describe, expect, it } from 'vitest';
import { childSeed, keyHash, keygen, policyProgram, sendMultisig, sendSingleKey, sign } from './wallet-mldsa';

describe('wallet-mldsa', () => {
  it('matches the node tool on seed 11…11', () => {
    const seed = new Uint8Array(32).fill(0x11);
    const { publicKey, secretKey } = keygen(seed);
    expect(publicKey.length).toBe(1312);
    expect(secretKey.length).toBe(2560);
    expect(Buffer.from(keyHash(publicKey)).toString('hex')).toBe(
      '54c981c4059222f4f9b4a406a13230cd2786ab8a3e026d5700bedeb2b3b64c82',
    );
    const sig = sign(new Uint8Array(32).fill(0xaa), secretKey);
    expect(sig.length).toBe(2420);
    expect(Buffer.from(sig.subarray(0, 16)).toString('hex')).toBe('5793ddede5ba766ada8ff8366b720ddf');
  });

  it('builds single-key and 2-of-3 witnesses as two functions', () => {
    const a = keygen(childSeed(new Uint8Array(64).fill(1), 0));
    const b = keygen(childSeed(new Uint8Array(64).fill(2), 0));
    const c = keygen(childSeed(new Uint8Array(64).fill(3), 0));
    const hashes = [keyHash(a.publicKey), keyHash(b.publicKey), keyHash(c.publicKey)];
    const program = policyProgram(2, hashes);
    expect(program.length).toBe(32);
    const msg = new Uint8Array(32).fill(7);
    const single = sendSingleKey(a.publicKey, sign(msg, a.secretKey));
    expect(single).toHaveLength(2);
    const multi = sendMultisig([
      { pubkey: a.publicKey, signature: sign(msg, a.secretKey) },
      { pubkey: b.publicKey, signature: sign(msg, b.secretKey) },
      { keyHash: keyHash(c.publicKey) },
    ]);
    expect(multi).toHaveLength(5);
    expect(multi[4]).toEqual(keyHash(c.publicKey));
  });
});
