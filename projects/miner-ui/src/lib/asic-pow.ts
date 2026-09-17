import { blake2b } from '@noble/hashes/blake2.js';

export function blake2b32(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}

export function writeLe32(out: Uint8Array, offset: number, n: number): void {
  out[offset] = n & 0xff;
  out[offset + 1] = (n >>> 8) & 0xff;
  out[offset + 2] = (n >>> 16) & 0xff;
  out[offset + 3] = (n >>> 24) & 0xff;
}

export function toHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function parseHex(s: string): Uint8Array {
  const h = s.trim();
  if (h.length % 2 !== 0) {
    throw new Error('odd hex');
  }
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** DATUM profile-0 work root: blake2b-256 of 0x00 || coinb1(39) || extranonce12. */
export function datumWorkRoot(coinb1: Uint8Array, extranonce12: Uint8Array): Uint8Array {
  const leaf = new Uint8Array(52);
  leaf[0] = 0;
  leaf.set(coinb1, 1);
  leaf.set(extranonce12, 40);
  return blake2b32(leaf);
}

export function datumWorkHeader(
  prevHidden: Uint8Array,
  nonce8: Uint8Array,
  ntime8: Uint8Array,
  root: Uint8Array,
): Uint8Array {
  const work = new Uint8Array(80);
  work.set(prevHidden, 0);
  work.set(nonce8, 32);
  work.set(ntime8, 40);
  work.set(root, 48);
  return work;
}

/** Blake2b-256 of 80-byte work, XOR mask, byte-reverse. Zero mask when xorKey is empty/zero. */
export function asicPowHash(work: Uint8Array, xorKey: Uint8Array = new Uint8Array(16), xorClearBits = 0): Uint8Array {
  if (work.length !== 80) {
    throw new Error('asicPowHash expects 80-byte work');
  }
  const hash = blake2b32(work);
  const mask = xorKeyMaskBytes(xorKey, xorClearBits);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[31 - i] = hash[i]! ^ mask[i]!;
  }
  return out;
}

export function xorKeyMaskBytes(xorKey: Uint8Array, _xorClearBits: number): Uint8Array {
  const mask = new Uint8Array(32);
  for (let i = 0; i < xorKey.length; i++) {
    if (xorKey[i] !== 0) {
      // Web hasher uses a zero XOR key (Stratum profile-0). Non-zero masks stay on the native path.
      return mask;
    }
  }
  return mask;
}

export function hashMeetsTarget(hash: Uint8Array, target: Uint8Array): boolean {
  for (let i = 31; i >= 0; i--) {
    if (hash[i]! < target[i]!) {
      return true;
    }
    if (hash[i]! > target[i]!) {
      return false;
    }
  }
  return true;
}

export function targetFromCompact(nBits: number): Uint8Array | null {
  const target = new Uint8Array(32);
  const nSize = nBits >>> 24;
  let nWord = nBits & 0x007fffff;
  if (nBits & 0x00800000) {
    return null;
  }
  if (nSize <= 3) {
    nWord >>>= 8 * (3 - nSize);
    target[0] = nWord & 0xff;
    target[1] = (nWord >>> 8) & 0xff;
    target[2] = (nWord >>> 16) & 0xff;
    target[3] = (nWord >>> 24) & 0xff;
  } else {
    if (nSize > 32) {
      return null;
    }
    const offset = nSize - 3;
    target[offset] = nWord & 0xff;
    target[offset + 1] = (nWord >>> 8) & 0xff;
    target[offset + 2] = (nWord >>> 16) & 0xff;
    target[offset + 3] = (nWord >>> 24) & 0xff;
  }
  return nWord !== 0 ? target : null;
}

const POW_LIMIT = 0xffffn << 216n;

export function targetToBig(target: Uint8Array): bigint {
  let n = 0n;
  for (let i = 31; i >= 0; i--) {
    n = (n << 8n) + BigInt(target[i]!);
  }
  return n;
}

export function bigToTarget(n: bigint): Uint8Array {
  const t = new Uint8Array(32);
  let v = n;
  for (let i = 0; i < 32; i++) {
    t[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return t;
}

export function shareTargetFromDiff(diff: bigint): Uint8Array {
  if (diff <= 0n) {
    throw new Error('share difficulty must be positive');
  }
  return bigToTarget(POW_LIMIT / diff);
}

export function grindTargetForShare(nBits: number, shareDiff: bigint): Uint8Array | null {
  const block = targetFromCompact(nBits);
  if (!block) {
    return null;
  }
  const share = shareTargetFromDiff(shareDiff);
  return targetToBig(block) >= targetToBig(share) ? block : share;
}
