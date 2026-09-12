import { describe, expect, it } from 'vitest';
import { readLe32 } from './bytes.js';
import { GPU_EXTRANONCE2_BASE, gpuExtraNonce2, listGpus } from './gpu.js';

describe('GPU extraNonce2', () => {
  it('starts at 64 so it cannot collide with 64 CPU workers', () => {
    expect(GPU_EXTRANONCE2_BASE).toBe(64);
    expect(readLe32(gpuExtraNonce2(0), 0)).toBe(64);
    expect(readLe32(gpuExtraNonce2(1), 0)).toBe(65);
    expect(gpuExtraNonce2(0).length).toBe(8);
  });

  it('listGpus does not throw without an addon', () => {
    expect(Array.isArray(listGpus())).toBe(true);
  });
});
