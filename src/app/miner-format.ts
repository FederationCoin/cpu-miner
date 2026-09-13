import type { MinerChain } from './chain';

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
    return 'Loading OpenCL. A bad driver can take down this app.';
  }
  if (!state.scanned) {
    return 'No OpenCL GPUs listed yet. Detect loads the GPU driver in-process (a bad ICD can take down this app; skip this on WSL). CPU threads still mine.';
  }
  if (!state.addon) {
    return 'No GPU hasher in this build. CPU threads still mine.';
  }
  if (state.deviceCount === 0) {
    return 'No OpenCL GPUs. Install NVIDIA, AMD, or Intel GPU drivers (not the CUDA Toolkit). CPU threads still mine.';
  }
  return 'Off until you tick a card. CPU workers stay on. Combined hashrate below. ccminer “blake2b” is the wrong PoW.';
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
