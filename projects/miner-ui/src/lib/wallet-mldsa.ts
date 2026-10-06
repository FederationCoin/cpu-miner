import { blake2b32 } from './asic-pow';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';

export const MLDSA_CONTEXT = new TextEncoder().encode('FederationCoin');
const KEY_TAG = new TextEncoder().encode('FCN-MLDSA44-KEY');
const POLICY_TAG = new TextEncoder().encode('FCN-MLDSA44-POLICY');
const CHILD_TAG = new TextEncoder().encode('FCN-MLDSA44-CHILD');

export function childSeed(master: Uint8Array, index: number): Uint8Array {
  const idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, index >>> 0, false);
  const pre = new Uint8Array(1 + CHILD_TAG.length + master.length + 4);
  pre[0] = 0x11;
  pre.set(CHILD_TAG, 1);
  pre.set(master, 1 + CHILD_TAG.length);
  pre.set(idx, 1 + CHILD_TAG.length + master.length);
  return blake2b32(pre);
}

export function keygen(seed32: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return ml_dsa44.keygen(seed32);
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_dsa44.sign(message, secretKey, { context: MLDSA_CONTEXT, extraEntropy: false });
}

export function keyHash(pubkey: Uint8Array): Uint8Array {
  const pre = new Uint8Array(1 + KEY_TAG.length + pubkey.length);
  pre[0] = 0x0f;
  pre.set(KEY_TAG, 1);
  pre.set(pubkey, 1 + KEY_TAG.length);
  return blake2b32(pre);
}

export function policyProgram(threshold: number, hashes: Uint8Array[]): Uint8Array {
  const ordered = [...hashes].sort((a, b) => {
    for (let i = 0; i < 32; i++) {
      if (a[i] !== b[i]) {
        return a[i]! - b[i]!;
      }
    }
    return 0;
  });
  const pre = new Uint8Array(1 + POLICY_TAG.length + 2 + ordered.length * 32);
  pre[0] = 0x12;
  pre.set(POLICY_TAG, 1);
  pre[1 + POLICY_TAG.length] = threshold;
  pre[2 + POLICY_TAG.length] = ordered.length;
  let off = 3 + POLICY_TAG.length;
  for (const hash of ordered) {
    pre.set(hash, off);
    off += 32;
  }
  return blake2b32(pre);
}

export function sendSingleKey(pubkey: Uint8Array, signature: Uint8Array): Uint8Array[] {
  return [pubkey, signature];
}

export function sendMultisig(
  slots: Array<{ pubkey: Uint8Array; signature: Uint8Array } | { keyHash: Uint8Array }>,
): Uint8Array[] {
  const stack: Uint8Array[] = [];
  for (const slot of slots) {
    if ('keyHash' in slot) {
      stack.push(slot.keyHash);
    } else {
      stack.push(slot.pubkey);
      stack.push(slot.signature);
    }
  }
  return stack;
}
