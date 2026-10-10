import type { MinerChain } from './chain';
import type { GpuScanReason } from './miner-api';

export function mainIsNotLive(chainId: MinerChain, mainIsLive: boolean): boolean {
  return chainId === 'main' && !mainIsLive;
}

export function gpuStatusHint(state: {
  detecting: boolean;
  scanned: boolean;
  addon: boolean;
  deviceCount: number;
}): string {
  if (state.detecting) {
    return 'Loading GPU drivers. A bad ICD can take down this app.';
  }
  if (!state.scanned) {
    return 'No GPUs listed yet. Detect loads OpenCL or CUDA in-process (a bad ICD can take down this app). CPU threads still mine.';
  }
  if (!state.addon && state.deviceCount === 0) {
    return 'No GPU hasher in this build. CPU threads still mine.';
  }
  if (state.deviceCount === 0) {
    return 'No OpenCL or CUDA GPUs. CUDA is listed only when asic_pow.ptx loaded. CPU threads still mine.';
  }
  return 'Off until you pick a strategy. CPU workers stay on. Combined hashrate below. ccminer “blake2b” is the wrong PoW.';
}

export function cookiePathHint(datadir: string, chainId: MinerChain): string {
  const d = datadir.trim().replace(/[/\\]+$/, '');
  if (chainId === 'main') {
    return d ? `${d}/.cookie` : '';
  }
  if (!d) {
    return '';
  }
  if (d.endsWith('testnet3')) {
    return `${d}/.cookie`;
  }
  return `${d}/testnet3/.cookie`;
}

export function formatHashRate(n: number): string {
  if (n >= 1e6) {
    return `${(n / 1e6).toFixed(2)} MH/s`;
  }
  if (n >= 1e3) {
    return `${(n / 1e3).toFixed(2)} kH/s`;
  }
  return `${n.toFixed(0)} H/s`;
}

export function formatStakeGfCn(sats: string): string {
  let n: bigint;
  try {
    n = BigInt(sats);
  } catch {
    return sats;
  }
  const neg = n < 0n;
  const v = neg ? -n : n;
  const one = 100_000_000n;
  if (v > one) {
    const rounded = (v + 50_000_000n) / one;
    return `${neg ? '-' : ''}${rounded}`;
  }
  const whole = v / one;
  const frac = (v % one).toString().padStart(8, '0');
  const trimmed = `${whole}.${frac}`.replace(/0+$/, '').replace(/\.$/, '');
  return `${neg ? '-' : ''}${trimmed}`;
}

export function formatSats(sats: string): string {
  let n: bigint;
  try {
    n = BigInt(sats);
  } catch {
    return sats;
  }
  const neg = n < 0n;
  const v = neg ? -n : n;
  const whole = v / 100000000n;
  const frac = (v % 100000000n).toString().padStart(8, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export function gpuStatusHintWeb(state: {
  detecting: boolean;
  scanned: boolean;
  addon: boolean;
  deviceCount: number;
  reason?: GpuScanReason;
}): string {
  if (state.detecting) {
    return 'Asking the browser for a WebGPU adapter.';
  }
  if (!state.scanned) {
    return 'No GPUs listed yet. Detect uses WebGPU. Open Help to check chrome://gpu and enable it. CPU threads still mine.';
  }
  if (state.deviceCount === 0) {
    if (state.reason === 'no-api') {
      return 'This browser has no WebGPU API. Open Help to check chrome://gpu and enable it. CPU threads in this tab still mine.';
    }
    return 'No WebGPU adapter. Open Help to check chrome://gpu and enable it. CPU threads in this tab still mine.';
  }
  return 'Off until you pick WebGPU. CPU workers stay on. Combined hashrate below.';
}
