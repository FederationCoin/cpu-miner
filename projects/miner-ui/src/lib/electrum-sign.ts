import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const MESSAGE_MAGIC = 'FederationCoin Signed Message:\n';

function compactSize(n: number): Uint8Array {
  if (n < 253) {
    return Uint8Array.of(n);
  }
  throw new Error('message too long');
}

function serString(bytes: Uint8Array): Uint8Array {
  const prefix = compactSize(bytes.length);
  const out = new Uint8Array(prefix.length + bytes.length);
  out.set(prefix);
  out.set(bytes, prefix.length);
  return out;
}

export function magicHash(message: string): Uint8Array {
  const enc = new TextEncoder();
  const payload = new Uint8Array([
    ...serString(enc.encode(MESSAGE_MAGIC)),
    ...serString(enc.encode(message)),
  ]);
  return sha256(sha256(payload));
}

export function signElectrum(message: string, priv: Uint8Array): string {
  const hash = magicHash(message);
  const sig = secp256k1.sign(hash, priv, { prehash: false, format: 'recovered', lowS: true });
  const compact = new Uint8Array(65);
  compact[0] = 27 + 4 + sig[0];
  compact.set(sig.subarray(1), 1);
  let bin = '';
  for (const b of compact) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}
