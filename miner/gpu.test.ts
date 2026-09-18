import { describe, expect, it } from 'vitest';
import { readLe32 } from './bytes.js';
import { GPU_EXTRANONCE2_BASE, gpuExtraNonce2, listGpus, nativeIdForStrategy, startGpuGrindNative } from './gpu.js';

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

  it('startGpuGrindNative logs and returns false when startGrind throws', () => {
    const logs: string[] = [];
    expect(
      startGpuGrindNative(
        {
          startGrind: () => {
            throw new Error('unknown GPU id');
          },
        },
        {
          deviceId: 'cuda:0:card',
          work: new Uint8Array(80),
          target: new Uint8Array(32),
          xorKey: new Uint8Array(16),
          xorClear: 0,
          extraNonce2: new Uint8Array(8),
          gen: 0,
          onProgress: () => undefined,
          onFound: () => undefined,
          onLog: (m) => logs.push(m),
        },
      ),
    ).toBe(false);
    expect(logs.some((m) => /unknown GPU id/.test(m))).toBe(true);
  });
});

describe('nativeIdForStrategy', () => {
  it('matches CUDA index and OpenCL platform/device', () => {
    const devices = [
      {
        kind: 'cuda' as const,
        index: 0,
        id: 'cuda:0:card',
        name: 'card',
        vendor: 'NVIDIA',
        memoryMiB: 8,
        deviceKind: 'discrete' as const,
      },
      {
        kind: 'opencl' as const,
        platform: 0,
        device: 0,
        id: 'opencl:0:0:card',
        name: 'card',
        vendor: 'NVIDIA',
        memoryMiB: 8,
        deviceKind: 'discrete' as const,
      },
    ];
    expect(nativeIdForStrategy(devices, { kind: 'cuda', index: 0 })).toBe('cuda:0:card');
    expect(nativeIdForStrategy(devices, { kind: 'opencl', platform: 0, device: 0 })).toBe('opencl:0:0:card');
    expect(nativeIdForStrategy(devices, { kind: 'cuda', index: 1 })).toBeNull();
  });
});
