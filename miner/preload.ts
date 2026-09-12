import { contextBridge, ipcRenderer } from 'electron';
import type { LogLine } from './log.js';

export type MinerChain = 'main' | 'testnet';

export type MinerMode = 'rpc' | 'stratum';

export type MinerStats = {
  running: boolean;
  chain: MinerChain | null;
  hashrate: number;
  height: number;
  hashes: number;
  accepted: number;
  rejected: number;
  lastError: string;
  lastHash: string;
  status: string;
};

export type MinerInfo = {
  cookiePath: string;
  datadir: string;
  rpc: string;
  electron: boolean;
  defaultThreads: number;
};

export type MinerStartOpts = {
  chain: MinerChain;
  mode: MinerMode;
  threads: number;
  host?: string;
  port?: number;
  payout?: string;
  datadir?: string;
  worker?: string;
  password?: string;
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
  pickDatadir: () => ipcRenderer.invoke('miner:pickDatadir') as Promise<string | null>,
  logHistory: () => ipcRenderer.invoke('miner:logHistory') as Promise<LogLine[]>,
  onStats: (cb: (s: MinerStats) => void) => listen('miner:stats', cb),
  onLog: (cb: (line: LogLine) => void) => listen('miner:log', cb),
  onToast: (cb: (message: string) => void) => listen('miner:toast', cb),
});
