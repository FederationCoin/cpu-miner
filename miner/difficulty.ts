/** FederationCoin powLimit (main and testnet): 000000ffff… */

import { targetFromCompact } from './pow.js';

/** Display hex 000000ffff00… → integer 0xffff << 216. Compact 0x1e00ffff. */
export const POW_LIMIT = 0xffffn << 216n;

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

export function nDiffFromNBits(nBits: number): bigint {
  const compact = targetFromCompact(nBits);
  if (!compact) {
    throw new Error(`bad nBits ${nBits.toString(16)}`);
  }
  const target = targetToBig(compact);
  if (target === 0n) {
    throw new Error('nBits target is zero');
  }
  const d = POW_LIMIT / target;
  return d < 1n ? 1n : d;
}

/** Share target for vardiff D (difficulty-1 units). */
export function shareTargetFromDiff(diff: bigint): Uint8Array {
  if (diff <= 0n) {
    throw new Error('share difficulty must be positive');
  }
  return bigToTarget(POW_LIMIT / diff);
}

export function shareWorkFromTargetByte(targetByte: number): bigint {
  if (targetByte === 0xff || targetByte >= 63) {
    return 1n;
  }
  return 1n << BigInt(targetByte);
}

/** Larger compact target is easier work. */
export function easierTarget(a: Uint8Array, b: Uint8Array): Uint8Array {
  return targetToBig(a) >= targetToBig(b) ? a : b;
}

export function grindTargetForShare(nBits: number, shareDiff: bigint): Uint8Array | null {
  const block = targetFromCompact(nBits);
  if (!block) {
    return null;
  }
  return easierTarget(block, shareTargetFromDiff(shareDiff));
}

/** After a share, hunt the block nBits, not the easier share target. */
export function specAfterShareAccept<T extends { target: Uint8Array }>(spec: T, nBits: number): T | null {
  const block = targetFromCompact(nBits);
  if (!block) {
    return null;
  }
  return { ...spec, target: block };
}

/** Respawn the last job at block nBits; empty means the hasher would go idle. */
export function specsAfterShareAccept<T extends { target: Uint8Array }>(lastSpec: T | null, nBits: number): T[] {
  if (!lastSpec) {
    return [];
  }
  const next = specAfterShareAccept(lastSpec, nBits);
  return next ? [next] : [];
}
