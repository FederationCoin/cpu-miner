import { contextBridge, ipcRenderer } from 'electron';
import type { LogLine } from './log.js';
import type { MinerStartOpts } from './mine-to.js';
import type { MinerToast } from './toast.js';

export type { MinerChain } from './chain.js';
export type { MineTo, MineToKind, MinerStartOpts, RpcConnect, RpcAuthConnect, RpcAuthKind, StratumConnect } from './mine-to.js';

export type MinerLink = 'idle' | 'up' | 'down';

export type MinerStats = {
  running: boolean;
  chain: import('./chain.js').MinerChain | null;
  hashrate: number;
  height: number;
  hashes: number;
  accepted: number;
  rejected: number;
  lastError: string;
  lastHash: string;
  status: string;
  link: MinerLink;
};

export type MinerInfo = {
  cookiePath: string;
  datadir: string;
  rpc: string;
  electron: boolean;
  defaultThreads: number;
};

export type GpuScan = {
  devices: Array<{
    kind: 'cuda' | 'opencl';
    id: string;
    name: string;
    vendor: string;
    memoryMiB: number;
    deviceKind: 'discrete' | 'integrated';
    index?: number;
    platform?: number;
    device?: number;
  }>;
  addon: boolean;
};

export type PoolStartOpts = {
  chain: import('./chain.js').MinerChain;
  rpc: import('./mine-to.js').RpcConnect[];
  operator: string;
  feeBps: number;
  stratumHost: string;
  stratumPort: number;
  datumHost: string;
  datumPort: number;
};

export type TidesPayout = { miner: string; sats: string };

export type PoolStats = {
  running: boolean;
  chain: import('./chain.js').MinerChain | null;
  height: number;
  workers: number;
  accepted: number;
  rejected: number;
  lastError: string;
  status: string;
  stratumHost: string;
  stratumPort: number;
  datumHost: string;
  datumPort: number;
  payouts: TidesPayout[];
  minerNet: string;
  operatorFee: string;
  unfilledRemainder: string;
};

export type { LogLine };

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

contextBridge.exposeInMainWorld('miner', {
  start: (opts: MinerStartOpts) => ipcRenderer.invoke('miner:start', opts),
  stop: () => ipcRenderer.invoke('miner:stop'),
  info: () => ipcRenderer.invoke('miner:info') as Promise<MinerInfo>,
  gpus: () => ipcRenderer.invoke('miner:gpus') as Promise<GpuScan>,
  pickDatadir: () => ipcRenderer.invoke('miner:pickDatadir') as Promise<string | null>,
  logHistory: () => ipcRenderer.invoke('miner:logHistory') as Promise<LogLine[]>,
  onStats: (cb: (s: MinerStats) => void) => listen('miner:stats', cb),
  onLog: (cb: (line: LogLine) => void) => listen('miner:log', cb),
  onToast: (cb: (toast: MinerToast) => void) => listen('miner:toast', cb),
  onWebGpuJob: (cb: (job: unknown) => void) => listen('miner:webgpu-job', cb),
  onWebGpuStop: (cb: (msg: { gen: number }) => void) => listen('miner:webgpu-stop', cb),
  webGpuFound: (msg: unknown) => ipcRenderer.invoke('miner:webgpu-found', msg),
  webGpuProgress: (msg: unknown) => ipcRenderer.invoke('miner:webgpu-progress', msg),
  webGpuLog: (message: string) => ipcRenderer.invoke('miner:webgpu-log', message),
  poolStart: (opts: PoolStartOpts) => ipcRenderer.invoke('pool:start', opts),
  poolStop: () => ipcRenderer.invoke('pool:stop'),
  poolRefresh: () => ipcRenderer.invoke('pool:refresh'),
  onPoolStats: (cb: (s: PoolStats) => void) => listen('pool:stats', cb),
  registryRequest: (req: {
    method: string;
    path: string;
    chain: 'main' | 'testnet';
    body?: unknown;
    authorization?: string;
  }) => ipcRenderer.invoke('registry:request', req),
  extrasProbe: () => ipcRenderer.invoke('extras:probe'),
  nodeStart: (opts: { chain: import('./chain.js').MinerChain; datadir: string }) => ipcRenderer.invoke('node:start', opts),
  nodeStop: () => ipcRenderer.invoke('node:stop'),
  nodeStatus: (opts: { chain: import('./chain.js').MinerChain; datadir: string }) => ipcRenderer.invoke('node:status', opts),
  gatewayStart: (opts: unknown) => ipcRenderer.invoke('gateway:start', opts),
  gatewayStop: () => ipcRenderer.invoke('gateway:stop'),
  gatewayStatus: (opts: { chain: import('./chain.js').MinerChain; configPath: string }) =>
    ipcRenderer.invoke('gateway:status', opts),
  fetchPrimeKeys: (url: string) => ipcRenderer.invoke('prime:fetchKeys', url),
  walletLoad: (chain: import('./chain.js').MinerChain) => ipcRenderer.invoke('wallet:load', chain),
  walletSave: (chain: import('./chain.js').MinerChain, blob: string) => ipcRenderer.invoke('wallet:save', chain, blob),
});
