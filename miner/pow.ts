// Header-v2 GetHash. Port of cpu-miner/src/pow.cpp (Knots CBlockHeader::GetHash).

import {
  concat,
  copyBytes,
  isAllZero,
  readLe16,
  readLe32,
  reverseCopy,
  writeLe16,
  writeLe32,
} from './bytes.js';
import { blake2b32, sha256d, taggedSha256 } from './hash.js';

export const VERSION_HEADER_V2 = 0x80000000;
export const FLAG_TIME_OFFSET = 4;
export const HEADER_V2_SIZE = 164;

export type HeaderV2 = {
  nVersion: number;
  hashPrevBlock: Uint8Array;
  hashMerkleRoot: Uint8Array;
  nTime: number;
  nBits: number;
  nNonce: number;
  nonce2: number;
  nonce3: number;
  extranonce: Uint8Array;
  timeOffset: number;
  txcount: number;
  flags: number;
  xorKeyMaskClearBits: number;
  xorKey: Uint8Array;
  height: number;
  mmRhs: Uint8Array;
};

export function emptyHeader(): HeaderV2 {
  return {
    nVersion: 0,
    hashPrevBlock: new Uint8Array(32),
    hashMerkleRoot: new Uint8Array(32),
    nTime: 0,
    nBits: 0,
    nNonce: 0,
    nonce2: 0,
    nonce3: 0,
    extranonce: new Uint8Array(16),
    timeOffset: 0,
    txcount: 0,
    flags: 0,
    xorKeyMaskClearBits: 0,
    xorKey: new Uint8Array(16),
    height: 0,
    mmRhs: new Uint8Array(32),
  };
}

export function cloneHeader(h: HeaderV2): HeaderV2 {
  return {
    nVersion: h.nVersion,
    hashPrevBlock: copyBytes(h.hashPrevBlock),
    hashMerkleRoot: copyBytes(h.hashMerkleRoot),
    nTime: h.nTime,
    nBits: h.nBits,
    nNonce: h.nNonce,
    nonce2: h.nonce2,
    nonce3: h.nonce3,
    extranonce: copyBytes(h.extranonce),
    timeOffset: h.timeOffset,
    txcount: h.txcount,
    flags: h.flags,
    xorKeyMaskClearBits: h.xorKeyMaskClearBits,
    xorKey: copyBytes(h.xorKey),
    height: h.height,
    mmRhs: copyBytes(h.mmRhs),
  };
}

export function completeVersion(h: HeaderV2): number {
  return (VERSION_HEADER_V2 | ((h.nVersion >>> 0) & ~VERSION_HEADER_V2)) >>> 0;
}

export function timeOnWire(h: HeaderV2): number {
  if ((h.flags & FLAG_TIME_OFFSET) === 0) {
    return h.nTime >>> 0;
  }
  return (h.nTime - h.timeOffset) >>> 0;
}

export function serializeHeader(h: HeaderV2): Uint8Array {
  const out = new Uint8Array(HEADER_V2_SIZE);
  writeLe32(out, 0, completeVersion(h));
  out.set(h.hashPrevBlock, 4);
  out.set(h.hashMerkleRoot, 36);
  writeLe32(out, 68, timeOnWire(h));
  writeLe32(out, 72, h.nBits);
  writeLe32(out, 76, h.nNonce);
  writeLe32(out, 80, h.nonce2);
  writeLe32(out, 84, h.nonce3);
  out.set(h.extranonce, 88);
  writeLe32(out, 104, h.timeOffset);
  writeLe16(out, 108, h.txcount);
  out[110] = h.flags & 0xff;
  out[111] = h.xorKeyMaskClearBits & 0xff;
  out.set(h.xorKey, 112);
  writeLe32(out, 128, h.height >>> 0);
  out.set(h.mmRhs, 132);
  return out;
}

export function deserializeHeader(input: Uint8Array): HeaderV2 | null {
  if (input.length < HEADER_V2_SIZE) {
    return null;
  }
  const v = readLe32(input, 0);
  if ((v & VERSION_HEADER_V2) === 0) {
    return null;
  }
  const h = emptyHeader();
  h.nVersion = (v & ~VERSION_HEADER_V2) | 0;
  h.hashPrevBlock = input.slice(4, 36);
  h.hashMerkleRoot = input.slice(36, 68);
  const wire = readLe32(input, 68);
  h.nBits = readLe32(input, 72);
  h.nNonce = readLe32(input, 76);
  h.nonce2 = readLe32(input, 80);
  h.nonce3 = readLe32(input, 84);
  h.extranonce = input.slice(88, 104);
  h.timeOffset = readLe32(input, 104);
  h.txcount = readLe16(input, 108);
  h.flags = input[110]!;
  h.xorKeyMaskClearBits = input[111]!;
  h.xorKey = input.slice(112, 128);
  h.height = readLe32(input, 128) | 0;
  h.mmRhs = input.slice(132, 164);
  if (h.flags & FLAG_TIME_OFFSET) {
    h.nTime = (wire + h.timeOffset) >>> 0;
  } else {
    h.nTime = wire;
  }
  return h;
}

function xorKeyMaskBytes(xorKey: Uint8Array, clearBits: number): Uint8Array {
  const mask = new Uint8Array(32);
  if (isAllZero(xorKey)) {
    return mask;
  }
  mask.set(taggedSha256('Bitcoin block hash PoW XOR mask', xorKey));
  const clearBytes = Math.floor(clearBits / 8);
  mask.fill(0, 0, Math.min(clearBytes, 32));
  if (clearBytes < 32) {
    mask[clearBytes] = mask[clearBytes]! & (0xff >>> (clearBits % 8));
  }
  return mask;
}

export function mergeMiningCommitment(h: HeaderV2): Uint8Array {
  const xorKeyHash = taggedSha256('Bitcoin block hash PoW XOR key', h.xorKey);
  const prevOrdered = reverseCopy(h.hashPrevBlock);
  const h1 = new Uint8Array(119);
  let o = 0;
  writeLe32(h1, o, completeVersion(h));
  o += 4;
  h1.set(prevOrdered, o);
  o += 32;
  writeLe32(h1, o, h.height >>> 0);
  o += 4;
  h1.set(h.hashMerkleRoot, o);
  o += 32;
  writeLe32(h1, o, timeOnWire(h));
  o += 4;
  h1[o++] = 0;
  writeLe32(h1, o, h.nBits);
  o += 4;
  writeLe32(h1, o, h.txcount >>> 0);
  o += 4;
  h1[o++] = h.flags & 0xff;
  h1[o++] = h.xorKeyMaskClearBits & 0xff;
  h1.set(xorKeyHash, o);

  const h1Hash = taggedSha256('Bitcoin block header 1', h1);
  const h2 = new Uint8Array(96);
  h2.set(h1Hash, 0);
  h2.set(h.mmRhs, 64);
  return taggedSha256('Merge-mining hook', h2);
}

export function asicPreimage(h: HeaderV2): Uint8Array {
  const h2Hash = mergeMiningCommitment(h);
  const leaf = new Uint8Array(52);
  leaf.set(h2Hash, 4);
  leaf.set(h.extranonce, 36);
  const workRoot = blake2b32(leaf);

  const parts: Uint8Array[] = [];
  const tmp = new Uint8Array(4);
  const profile = h.flags & 3;
  switch (profile) {
    case 3:
      parts.push(new Uint8Array(16), new Uint8Array(16));
    // fallthrough
    case 2:
      parts.push(new Uint8Array(16), new Uint8Array(16), new Uint8Array(16), h2Hash);
      writeLe32(tmp, 0, h.nNonce);
      parts.push(copyBytes(tmp));
      writeLe32(tmp, 0, h.nonce2);
      parts.push(copyBytes(tmp));
      writeLe32(tmp, 0, h.timeOffset);
      parts.push(copyBytes(tmp));
      writeLe32(tmp, 0, h.nonce3);
      parts.push(copyBytes(tmp));
      parts.push(workRoot);
      break;
    case 0: {
      const prevOrdered = reverseCopy(h.hashPrevBlock);
      const prevHidden = taggedSha256('Bitcoin prevblock header, hashed', prevOrdered);
      prevHidden.fill(0, 0, 6);
      parts.push(prevHidden);
      writeLe32(tmp, 0, h.nNonce);
      parts.push(copyBytes(tmp));
      writeLe32(tmp, 0, h.nonce2);
      parts.push(copyBytes(tmp));
      writeLe32(tmp, 0, h.timeOffset);
      parts.push(copyBytes(tmp));
      writeLe32(tmp, 0, h.nonce3);
      parts.push(copyBytes(tmp));
      parts.push(workRoot);
      break;
    }
    case 1:
      writeLe32(tmp, 0, h.nNonce);
      parts.push(copyBytes(tmp));
      writeLe32(tmp, 0, h.nonce2);
      parts.push(copyBytes(tmp));
      writeLe32(tmp, 0, h.nonce3);
      parts.push(copyBytes(tmp));
      writeLe32(tmp, 0, h.timeOffset);
      parts.push(copyBytes(tmp));
      parts.push(workRoot, h2Hash);
      break;
    default:
      throw new Error('asic profile');
  }
  return concat(...parts);
}

export function headerHash(h: HeaderV2): Uint8Array {
  const asic = asicPreimage(h);
  const hash = blake2b32(asic);
  const mask = xorKeyMaskBytes(h.xorKey, h.xorKeyMaskClearBits);
  const finalHash = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    finalHash[31 - i] = hash[i]! ^ mask[i]!;
  }
  return finalHash;
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

export function merkleRoot(txids: Uint8Array[]): Uint8Array {
  if (txids.length === 0) {
    return new Uint8Array(32);
  }
  let layer = txids.map(copyBytes);
  while (layer.length > 1) {
    if (layer.length % 2 === 1) {
      layer.push(copyBytes(layer[layer.length - 1]!));
    }
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(sha256d(concat(layer[i]!, layer[i + 1]!)));
    }
    layer = next;
  }
  return layer[0]!;
}

export function datumCoinb1(commitment: Uint8Array): Uint8Array {
  const out = new Uint8Array(39);
  out.set(commitment, 3);
  return out;
}

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

export function asicPowHash(work: Uint8Array, xorKey: Uint8Array, xorClearBits: number): Uint8Array {
  const hash = blake2b32(work);
  const xorKeyMask = xorKeyMaskBytes(xorKey, xorClearBits);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[31 - i] = hash[i]! ^ xorKeyMask[i]!;
  }
  return out;
}

export function prevHiddenFromPrev(hashPrevBlock: Uint8Array): Uint8Array {
  const prevOrdered = reverseCopy(hashPrevBlock);
  const hidden = taggedSha256('Bitcoin prevblock header, hashed', prevOrdered);
  hidden.fill(0, 0, 6);
  return hidden;
}
