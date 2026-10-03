import { keygen, sign } from './wallet-mldsa';

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
  return payload;
}

export function signElectrum(message: string, seed32: Uint8Array): string {
  const payload = magicHash(message);
  const { secretKey } = keygen(seed32);
  const sig = sign(payload, secretKey);
  let bin = '';
  for (const b of sig) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}
