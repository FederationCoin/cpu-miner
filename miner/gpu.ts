import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLe32 } from './bytes.js';

const here = dirname(fileURLToPath(import.meta.url));

/** CPU workers use extraNonce2 0..63. GPU g uses 64+g. */
export const GPU_EXTRANONCE2_BASE = 64;

export type GpuDevice = {
  id: string;
  name: string;
  vendor: string;
  memoryMiB: number;
  backend: 'opencl';
  kind: 'discrete' | 'integrated';
};

type Native = {
  listDevices: () => GpuDevice[];
  setKernelSource: (src: string) => void;
  asicPowHash: (work: Uint8Array, xorKey: Uint8Array, xorClear: number) => Buffer;
  startGrind: (
    job: {
      deviceId: string;
      work: Uint8Array;
      target: Uint8Array;
      xorKey: Uint8Array;
      xorClear: number;
      extraNonce2: Uint8Array;
      gen: number;
    },
    onProgress: (hashes: number) => void,
    onFound: (msg: { type: string; nonce: number; nonce2: number; hashes: number }) => void,
    onLog: (msg: string) => void,
  ) => void;
  stopGrind: () => void;
};

const require = createRequire(import.meta.url);

function addonPath(): string | null {
  const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const candidates = [
    resources ? join(resources, 'gpu-hasher', 'gpu-hasher.node') : '',
    join(here, '../native/gpu-hasher/dist/gpu-hasher.node'),
    join(here, '../native/gpu-hasher/build/Release/gpu-hasher.node'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      return p;
    }
  }
  return null;
}

function kernelPath(addonFile: string): string | null {
  const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const candidates = [
    join(dirname(addonFile), 'asic_pow.cl'),
    resources ? join(resources, 'gpu-hasher', 'asic_pow.cl') : '',
    join(here, '../native/gpu-hasher/kernel/asic_pow.cl'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      return p;
    }
  }
  return null;
}

let native: Native | null | undefined;

function loadNative(): Native | null {
  if (native !== undefined) {
    return native;
  }
  const file = addonPath();
  if (!file) {
    native = null;
    return null;
  }
  try {
    native = require(file) as Native;
    const k = kernelPath(file);
    if (k) {
      native.setKernelSource(readFileSync(k, 'utf8'));
    }
    return native;
  } catch {
    native = null;
    return null;
  }
}

export function gpuExtraNonce2(gpuIndex: number): Uint8Array {
  const extra = new Uint8Array(8);
  writeLe32(extra, 0, GPU_EXTRANONCE2_BASE + gpuIndex);
  return extra;
}

export function listGpus(): GpuDevice[] {
  return scanGpus().devices;
}

export function scanGpus(): { devices: GpuDevice[]; addon: boolean } {
  const n = loadNative();
  if (!n) {
    return { devices: [], addon: false };
  }
  try {
    return { devices: n.listDevices() ?? [], addon: true };
  } catch {
    return { devices: [], addon: true };
  }
}

export function stopGpu(): void {
  try {
    loadNative()?.stopGrind();
  } catch {
    /* CPU mining continues */
  }
}

export function startGpuGrind(opts: {
  deviceId: string;
  work: Uint8Array;
  target: Uint8Array;
  xorKey: Uint8Array;
  xorClear: number;
  extraNonce2: Uint8Array;
  gen: number;
  onProgress: (hashes: number) => void;
  onFound: (msg: { nonce: number; nonce2: number; hashes: number }) => void;
  onLog: (msg: string) => void;
}): boolean {
  return startGpuGrindNative(loadNative(), opts);
}

/** Missing-addon fork. Tests pass null so this file does not load OpenCL. */
export function startGpuGrindNative(
  n: Pick<Native, 'startGrind'> | null,
  opts: {
    deviceId: string;
    work: Uint8Array;
    target: Uint8Array;
    xorKey: Uint8Array;
    xorClear: number;
    extraNonce2: Uint8Array;
    gen: number;
    onProgress: (hashes: number) => void;
    onFound: (msg: { nonce: number; nonce2: number; hashes: number }) => void;
    onLog: (msg: string) => void;
  },
): boolean {
  if (!n) {
    return false;
  }
  n.startGrind(
    {
      deviceId: opts.deviceId,
      work: Buffer.from(opts.work),
      target: Buffer.from(opts.target),
      xorKey: Buffer.from(opts.xorKey),
      xorClear: opts.xorClear,
      extraNonce2: Buffer.from(opts.extraNonce2),
      gen: opts.gen,
    },
    opts.onProgress,
    (msg) => {
      opts.onFound({ nonce: msg.nonce, nonce2: msg.nonce2, hashes: msg.hashes });
    },
    opts.onLog,
  );
  return true;
}
