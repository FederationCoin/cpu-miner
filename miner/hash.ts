import { blake2b } from '@noble/hashes/blake2.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { concat } from './bytes.js';

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

export function sha256d(data: Uint8Array): Uint8Array {
  return nobleSha256(nobleSha256(data));
}

/** SHA256(tag) || SHA256(tag) || msg, then SHA256. BIP340-style tagged hash. */
export function taggedSha256(tag: string, msg: Uint8Array): Uint8Array {
  const tagHash = nobleSha256(new TextEncoder().encode(tag));
  return nobleSha256(concat(tagHash, tagHash, msg));
}

/** blake2b_nokey, 32-byte digest. Not blake2b-512. */
export function blake2b32(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}
