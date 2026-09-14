export type MinerChain = 'main' | 'testnet';

export type MinerMode = 'rpc' | 'stratum';

export type LogLine = {
  t: number;
  mode: string;
  message: string;
};

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

export type GpuDevice = {
  id: string;
  name: string;
  vendor: string;
  memoryMiB: number;
  backend: 'opencl';
  kind: 'discrete' | 'integrated';
};

export type GpuScan = {
  devices: GpuDevice[];
  addon: boolean;
};

export type MinerStartOpts = {
  chain: MinerChain;
  mode: MinerMode;
  threads: number;
  gpuIds?: string[];
  host?: string;
  port?: number;
  payout?: string;
  datadir?: string;
  worker?: string;
  password?: string;
};

export type PoolStartOpts = {
  chain: MinerChain;
  rpcHost: string;
  rpcPort: number;
  datadir: string;
  operator: string;
  feeBps: number;
  stratumHost: string;
  stratumPort: number;
  datumHost: string;
  datumPort: number;
};

export type PoolStats = {
  running: boolean;
  chain: MinerChain | null;
  height: number;
  workers: number;
  accepted: number;
  rejected: number;
  lastError: string;
  status: string;
  stratumPort: number;
  datumPort: number;
};

export type MinerApi = {
  start: (opts: MinerStartOpts) => Promise<{ ok: boolean; error?: string }>;
  stop: () => Promise<void>;
  info: () => Promise<MinerInfo>;
  gpus: () => Promise<GpuScan>;
  pickDatadir: () => Promise<string | null>;
  logHistory: () => Promise<LogLine[]>;
  onStats: (cb: (s: MinerStats) => void) => () => void;
  onLog: (cb: (line: LogLine) => void) => () => void;
  onToast: (cb: (message: string) => void) => () => void;
  poolStart: (opts: PoolStartOpts) => Promise<{ ok: boolean; error?: string }>;
  poolStop: () => Promise<void>;
  onPoolStats: (cb: (s: PoolStats) => void) => () => void;
};

declare global {
  interface Window {
    miner?: MinerApi;
  }
}

export {};
