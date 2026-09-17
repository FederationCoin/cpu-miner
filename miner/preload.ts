import { contextBridge, ipcRenderer } from 'electron';
import type { LogLine } from './log.js';
import type { MinerStartOpts } from './mine-to.js';

export type { MinerChain } from './chain.js';
export type { MineTo, MineToKind, MinerStartOpts, RpcConnect, RpcAuthConnect, RpcAuthKind, StratumConnect, DatumConnect } from './mine-to.js';

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

export type GpuDevice = {
  id: string;
  name: string;
  vendor: string;
  memoryMiB: number;
  backend: 'opencl' | 'cuda';
  kind: 'discrete' | 'integrated';
};

export type GpuScan = {
  devices: GpuDevice[];
  addon: boolean;
};

export type PoolStartOpts = {
  chain: import('./chain.js').MinerChain;
  rpc: import('./mine-to.js').RpcConnect;
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
  onToast: (cb: (message: string) => void) => listen('miner:toast', cb),
  poolStart: (opts: PoolStartOpts) => ipcRenderer.invoke('pool:start', opts),
  poolStop: () => ipcRenderer.invoke('pool:stop'),
  poolRefresh: () => ipcRenderer.invoke('pool:refresh'),
  onPoolStats: (cb: (s: PoolStats) => void) => listen('pool:stats', cb),
});
