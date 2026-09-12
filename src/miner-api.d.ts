export type MinerMode = 'rpc' | 'stratum';

export type LogLine = {
  t: number;
  mode: string;
  message: string;
};

export type MinerStats = {
  running: boolean;
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
  mode: MinerMode;
  threads: number;
  host?: string;
  port?: number;
  payout?: string;
  datadir?: string;
  worker?: string;
  password?: string;
};

export type MinerApi = {
  start: (opts: MinerStartOpts) => Promise<{ ok: boolean; error?: string }>;
  stop: () => Promise<void>;
  info: () => Promise<MinerInfo>;
  pickDatadir: () => Promise<string | null>;
  logHistory: () => Promise<LogLine[]>;
  onStats: (cb: (s: MinerStats) => void) => () => void;
  onLog: (cb: (line: LogLine) => void) => () => void;
  onToast: (cb: (message: string) => void) => () => void;
};

declare global {
  interface Window {
    miner?: MinerApi;
  }
}

export {};
