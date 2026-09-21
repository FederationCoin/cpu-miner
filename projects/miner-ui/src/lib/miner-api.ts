import type { GpuPick, NativeGpuDevice } from './gpu-catalog';
import type { RegistryRequest, RegistryResponse } from './registry';

export type MinerChain = 'main' | 'testnet';

export type LogLine = {
  t: number;
  mode: string;
  message: string;
};

/** Always set on MinerStats. idle = not mining; up/down is the Stratum link. */
export type MinerLink = 'idle' | 'up' | 'down';

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
  link: MinerLink;
};

export type MinerInfo = {
  cookiePath: string;
  datadir: string;
  rpc: string;
  electron: boolean;
  defaultThreads: number;
};

export type { GpuAdapter, GpuPick, GpuStrategy, NativeGpuDevice, WebGpuDevice } from './gpu-catalog';

export type GpuScanReason = 'ok' | 'no-api' | 'no-adapter' | 'error';

export type GpuScan = {
  devices: NativeGpuDevice[];
  addon: boolean;
};

export type WebGpuIpcJob = {
  gen: number;
  label: string;
  work: number[];
  target: number[];
  mask: number[];
  extraNonce2: number[];
};

export type WebGpuIpcFound = {
  gen: number;
  nonce: number;
  nonce2: number;
  hashes: number;
  extraNonce2: number[];
};

export type WebGpuIpcProgress = {
  gen: number;
  hashes: number;
};

export const STRATUM_PASSWORD = 'x';

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

/** Web mill: WSS URL is the endpoint. Authorize password is always `x`. */
export type MineTo =
  | { kind: 'node'; rpc: RpcConnect; payout: string }
  | { kind: 'stratum'; stratum: StratumConnect }
  | { kind: 'stratumPoolWebsocket'; url: string; worker: string }
  | { kind: 'datumGatewayWebsocket'; url: string; worker: string };

export type MineToKind = MineTo['kind'];

export type WebStratumKind = 'stratumPoolWebsocket' | 'datumGatewayWebsocket';

export function isWebStratumKind(kind: MineToKind): kind is WebStratumKind {
  return kind === 'stratumPoolWebsocket' || kind === 'datumGatewayWebsocket';
}

export function isWebStratumMineTo(
  mineTo: MineTo,
): mineTo is Extract<MineTo, { kind: WebStratumKind }> {
  return isWebStratumKind(mineTo.kind);
}

export type MinerStartOpts = {
  chain: MinerChain;
  threads: number;
  gpus?: GpuPick[];
  mineTo: MineTo;
};

export type PoolStartOpts = {
  chain: MinerChain;
  rpc: RpcConnect[];
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
  minerNet: string;
  operatorFee: string;
  unfilledRemainder: string;
};

export function tidesSatsField(raw: unknown): string {
  if (typeof raw === 'string' && /^-?\d+$/.test(raw)) {
    return raw;
  }
  return '0';
}

export type ToastKind = 'ok' | 'error';

export type MinerToast = {
  message: string;
  kind: ToastKind;
};

export type ExtrasProbe = {
  node: boolean;
  gateway: boolean;
  pool: boolean;
};

export type NodeStatusView = {
  session: 'idle' | 'spawned' | 'attached';
  chain: MinerChain | null;
  height: number;
  running: boolean;
  lastError: string;
};

export type GatewayStatusView = {
  session: 'idle' | 'spawned';
  running: boolean;
  chain?: MinerChain;
  lastError: string;
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
  onToast: (cb: (toast: MinerToast) => void) => () => void;
  poolStart: (opts: PoolStartOpts) => Promise<{ ok: boolean; error?: string }>;
  poolStop: () => Promise<void>;
  poolRefresh: () => Promise<{ ok: boolean; error?: string }>;
  onPoolStats: (cb: (s: PoolStats) => void) => () => void;
  onWebGpuJob?: (cb: (job: WebGpuIpcJob) => void) => () => void;
  onWebGpuStop?: (cb: (msg: { gen: number }) => void) => () => void;
  webGpuFound?: (msg: WebGpuIpcFound) => Promise<void>;
  webGpuProgress?: (msg: WebGpuIpcProgress) => Promise<void>;
  webGpuLog?: (message: string) => Promise<void>;
  registryRequest?: (req: RegistryRequest) => Promise<RegistryResponse>;
  extrasProbe?: () => Promise<ExtrasProbe>;
  nodeStart?: (chain: MinerChain) => Promise<{ ok: boolean; error?: string }>;
  nodeStop?: () => Promise<{ ok: boolean; error?: string }>;
  nodeStatus?: (chain: MinerChain) => Promise<NodeStatusView>;
  gatewayStart?: (opts: {
    chain: MinerChain;
    poolAddress: string;
    poolHost?: string;
    poolPubkey?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  gatewayStop?: () => Promise<{ ok: boolean; error?: string }>;
  gatewayStatus?: () => Promise<GatewayStatusView>;
  walletLoad?: (chain: MinerChain) => Promise<string | null>;
  walletSave?: (chain: MinerChain, blob: string) => Promise<{ ok: boolean; error?: string }>;
};

declare global {
  interface Window {
    miner?: MinerApi;
  }
}
