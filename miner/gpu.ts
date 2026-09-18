import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLe32 } from './bytes.js';

const here = dirname(fileURLToPath(import.meta.url));

/** CPU workers use extraNonce2 0..63. GPU g uses 64+g. */
export const GPU_EXTRANONCE2_BASE = 64;

export type NativeGpuDevice =
  | {
      kind: 'cuda';
      index: number;
      id: string;
      name: string;
      vendor: string;
      memoryMiB: number;
      deviceKind: 'discrete' | 'integrated';
    }
  | {
      kind: 'opencl';
      platform: number;
      device: number;
      id: string;
      name: string;
      vendor: string;
      memoryMiB: number;
      deviceKind: 'discrete' | 'integrated';
    };

type AddonDevice = {
  id?: string;
  name?: string;
  vendor?: string;
  memoryMiB?: number;
  kind?: string;
  deviceKind?: string;
  backend?: string;
  index?: number;
  platform?: number;
  device?: number;
};

type Native = {
  listDevices: () => AddonDevice[];
  setKernelSource: (src: string) => void;
  setPtxSource?: (src: string) => void;
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

function ptxPath(addonFile: string): string | null {
  const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const candidates = [
    join(dirname(addonFile), 'asic_pow.ptx'),
    resources ? join(resources, 'gpu-hasher', 'asic_pow.ptx') : '',
    join(here, '../native/gpu-hasher/dist/asic_pow.ptx'),
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
  if (!process.versions.electron) {
    native = null;
    return null;
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
    const ptx = ptxPath(file);
    if (ptx && native.setPtxSource) {
      native.setPtxSource(readFileSync(ptx, 'utf8'));
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

function mapAddonDevice(raw: AddonDevice): NativeGpuDevice | null {
  const name = String(raw.name ?? '').trim();
  if (!name) {
    return null;
  }
  const vendor = String(raw.vendor ?? '');
  const memoryMiB = Number(raw.memoryMiB) || 0;
  const deviceKind: 'discrete' | 'integrated' =
    raw.deviceKind === 'integrated' || raw.kind === 'integrated' ? 'integrated' : 'discrete';
  const api = raw.kind === 'cuda' || raw.backend === 'cuda' || String(raw.id ?? '').startsWith('cuda:') ? 'cuda' : 'opencl';
  if (api === 'cuda') {
    const fromId = /^cuda:(\d+):/.exec(String(raw.id ?? ''));
    const index = Number.isInteger(raw.index) ? Number(raw.index) : fromId ? Number(fromId[1]) : NaN;
    if (!Number.isInteger(index) || index < 0) {
      return null;
    }
    return {
      kind: 'cuda',
      index,
      id: String(raw.id ?? `cuda:${index}:${name}`),
      name,
      vendor,
      memoryMiB,
      deviceKind,
    };
  }
  const fromId = /^opencl:(\d+):(\d+):/.exec(String(raw.id ?? ''));
  const platform = Number.isInteger(raw.platform) ? Number(raw.platform) : fromId ? Number(fromId[1]) : NaN;
  const device = Number.isInteger(raw.device) ? Number(raw.device) : fromId ? Number(fromId[2]) : NaN;
  if (!Number.isInteger(platform) || platform < 0 || !Number.isInteger(device) || device < 0) {
    return null;
  }
  return {
    kind: 'opencl',
    platform,
    device,
    id: String(raw.id ?? `opencl:${platform}:${device}:${name}`),
    name,
    vendor,
    memoryMiB,
    deviceKind,
  };
}

export function listGpus(): NativeGpuDevice[] {
  return scanGpus().devices;
}

export function scanGpus(): { devices: NativeGpuDevice[]; addon: boolean } {
  const n = loadNative();
  if (!n) {
    return { devices: [], addon: false };
  }
  try {
    const devices = (n.listDevices() ?? []).map(mapAddonDevice).filter((d): d is NativeGpuDevice => d !== null);
    return { devices, addon: true };
  } catch {
    return { devices: [], addon: true };
  }
}

export function nativeIdForStrategy(
  devices: NativeGpuDevice[],
  strategy: { kind: 'cuda'; index: number } | { kind: 'opencl'; platform: number; device: number },
): string | null {
  if (strategy.kind === 'cuda') {
    return devices.find((d) => d.kind === 'cuda' && d.index === strategy.index)?.id ?? null;
  }
  return (
    devices.find((d) => d.kind === 'opencl' && d.platform === strategy.platform && d.device === strategy.device)?.id ??
    null
  );
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
  try {
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
  } catch (e) {
    opts.onLog(e instanceof Error ? `gpu: ${e.message}` : 'gpu: start failed');
    return false;
  }
}
