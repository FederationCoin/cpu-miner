export type MinerChain = 'main' | 'testnet';

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
  backend: 'opencl' | 'cuda' | 'webgpu';
  kind: 'discrete' | 'integrated';
};

export type GpuScan = {
  devices: GpuDevice[];
  addon: boolean;
};

export type RpcAuthKind = 'cookie' | 'userpass';

export type RpcAuthConnect =
  | { kind: 'cookie'; datadir: string }
  | { kind: 'userpass'; user: string; password: string };

export type RpcConnect = {
  host: string;
  port: number;
  auth: RpcAuthConnect;
};

export type StratumConnect = {
  host: string;
  port: number;
  worker: string;
  password: string;
};

export type DatumConnect = {
  host: string;
  port: number;
  worker: string;
  rpc: RpcConnect;
};

export type MineTo =
  | { kind: 'node'; rpc: RpcConnect; payout: string }
  | { kind: 'stratum'; stratum: StratumConnect }
  | { kind: 'datum'; datum: DatumConnect }
  | { kind: 'appPoolStratum'; worker: string; password: string }
  | { kind: 'appPoolDatum'; worker: string; rpc: RpcConnect }
  | { kind: 'hostedPoolStratum'; worker: string; password: string };

export type MineToKind = MineTo['kind'];

export type MinerStartOpts = {
  chain: MinerChain;
  threads: number;
  gpuIds?: string[];
  mineTo: MineTo;
};

export type PoolStartOpts = {
  chain: MinerChain;
  rpc: RpcConnect;
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
  chain: MinerChain | null;
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
  poolRefresh: () => Promise<{ ok: boolean; error?: string }>;
  onPoolStats: (cb: (s: PoolStats) => void) => () => void;
};

declare global {
  interface Window {
    miner?: MinerApi;
  }
}
