import { describe, expect, it } from 'vitest';
import {
  POW_LIMIT,
  grindTargetForShare,
  shareTargetFromDiff,
  shareWorkFromTargetByte,
  specAfterShareAccept,
  specsAfterShareAccept,
  targetToBig,
} from './difficulty.js';
import { targetFromCompact } from './pow.js';

describe('share targets', () => {
  it('maps difficulty 1 to powLimit', () => {
    expect(targetToBig(shareTargetFromDiff(1n))).toBe(POW_LIMIT);
  });

  it('maps DATUM targetByte 0xff to difficulty 1', () => {
    expect(shareWorkFromTargetByte(0xff)).toBe(1n);
    expect(shareWorkFromTargetByte(8)).toBe(256n);
  });

  it('hunts share difficulty even when nBits is easier than the share', () => {
    const nBits = 0x1e00ffff;
    const block = targetFromCompact(nBits);
    expect(block).toBeTruthy();
    const grind = grindTargetForShare(nBits, 2n);
    expect(grind).toBeTruthy();
    expect(targetToBig(grind!)).toBe(targetToBig(shareTargetFromDiff(2n)));
    expect(targetToBig(grind!)).toBeLessThan(targetToBig(block!));
  });

  it('maps difficulty 1 over a harder block nBits to powLimit', () => {
    const nBits = 0x1b095cae;
    const block = targetFromCompact(nBits);
    expect(block).toBeTruthy();
    const grind = grindTargetForShare(nBits, 1n);
    expect(grind).toBeTruthy();
    expect(targetToBig(grind!)).toBe(POW_LIMIT);
    expect(targetToBig(grind!)).toBeGreaterThan(targetToBig(block!));
  });

  it('after a share, respawn uses the block nBits target', () => {
    const nBits = 0x1b095cae;
    const share = grindTargetForShare(nBits, 1n)!;
    const next = specAfterShareAccept({ target: share, job: 'keep' }, nBits);
    expect(next).toBeTruthy();
    expect(next!.job).toBe('keep');
    const block = targetFromCompact(nBits)!;
    expect(targetToBig(next!.target)).toBe(targetToBig(block));
    expect(targetToBig(next!.target)).toBeLessThan(targetToBig(share));
  });

  it('does not drop the last spec when nBits is valid', () => {
    const nBits = 0x1b095cae;
    const share = grindTargetForShare(nBits, 1n)!;
    expect(specAfterShareAccept({ target: share }, nBits)).not.toBeNull();
    expect(specAfterShareAccept({ target: share }, 0)).toBeNull();
    expect(specsAfterShareAccept({ target: share }, nBits)).toHaveLength(1);
    expect(specsAfterShareAccept(null, nBits)).toEqual([]);
  });
});
