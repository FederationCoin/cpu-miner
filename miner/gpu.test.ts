import { describe, expect, it } from 'vitest';
import { readLe32 } from './bytes.js';
import { GPU_EXTRANONCE2_BASE, gpuExtraNonce2, listGpus, startGpuGrindNative } from './gpu.js';

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

  it('startGpuGrindNative is false when the addon is missing', () => {
    expect(
      startGpuGrindNative(null, {
        deviceId: '0',
        work: new Uint8Array(80),
        target: new Uint8Array(32),
        xorKey: new Uint8Array(16),
        xorClear: 0,
        extraNonce2: new Uint8Array(8),
        gen: 0,
        onProgress: () => undefined,
        onFound: () => undefined,
        onLog: () => undefined,
      }),
    ).toBe(false);
  });
});
