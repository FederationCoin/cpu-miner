import { describe, expect, it } from 'vitest';
import { childSeedSecp, compressedPubkey, hash160, sendSecp, SECP_WARNING, warnSecpReceive, warnSecpSend } from './wallet-secp';

describe('wallet-secp', () => {
  it('warns on every receive and send', () => {
    expect(warnSecpReceive()).toBe(SECP_WARNING);
    expect(warnSecpSend()).toBe(SECP_WARNING);
    expect(SECP_WARNING).toMatch(/not quantum-safe/);
  });

  it('builds a P2WPKH stack from a child seed', () => {
    const priv = childSeedSecp(new Uint8Array(64).fill(9), 0);
    const pub = compressedPubkey(priv);
    expect(pub.length).toBe(33);
    expect(hash160(pub).length).toBe(20);
    const stack = sendSecp(new Uint8Array(71).fill(0x30), pub);
    expect(stack).toHaveLength(2);
    expect(stack[1]).toEqual(pub);
  });
});
