import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b32 } from './asic-pow';

export const SECP_WARNING = 'secp is cheap and not quantum-safe. The payment still goes.';

const CHILD_TAG = new TextEncoder().encode('FCN-SECP-CHILD');

export function childSeedSecp(master: Uint8Array, index: number): Uint8Array {
  const idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, index >>> 0, false);
  const pre = new Uint8Array(1 + CHILD_TAG.length + master.length + 4);
  pre[0] = 0x11;
  pre.set(CHILD_TAG, 1);
  pre.set(master, 1 + CHILD_TAG.length);
  pre.set(idx, 1 + CHILD_TAG.length + master.length);
  return blake2b32(pre);
}

export function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

export function compressedPubkey(priv32: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(priv32, true);
}

export function sendSecp(signatureWithHashtype: Uint8Array, compressed: Uint8Array): Uint8Array[] {
  return [signatureWithHashtype, compressed];
}

export function warnSecpReceive(): string {
  return SECP_WARNING;
}

export function warnSecpSend(): string {
  return SECP_WARNING;
}
