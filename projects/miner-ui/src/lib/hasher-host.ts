import { InjectionToken } from '@angular/core';
import type {
  ExtrasProbe,
  GatewayStatusView,
  GpuScan,
  MinerChain,
  MinerInfo,
  MinerStartOpts,
  MinerStats,
  MinerToast,
  NodeStatusView,
  PoolStartOpts,
  PoolStats,
} from './miner-api';
import type { RegistryRequest, RegistryResponse } from './registry';
import type { GatewayInfoRpc } from './stratum-ws';

export type HasherHost = {
  canMine: boolean;
  inElectron: boolean;
  start: (opts: MinerStartOpts) => Promise<{ ok: boolean; error?: string }>;
  stop: () => Promise<void>;
  info: () => Promise<MinerInfo | null>;
  gpus: () => Promise<GpuScan>;
  pickDatadir: () => Promise<string | null>;
  onStats: (cb: (s: MinerStats) => void) => () => void;
  onToast: (cb: (toast: MinerToast) => void) => () => void;
  poolStart: (opts: PoolStartOpts) => Promise<{ ok: boolean; error?: string }>;
  poolStop: () => Promise<void>;
  onPoolStats: (cb: (s: PoolStats) => void) => () => void;
  registryRequest?: (req: RegistryRequest) => Promise<RegistryResponse>;
  miningSocketOpen?: () => boolean;
  requestGatewayInfo?: () => boolean;
  fetchGatewayInfo?: (url: string) => Promise<GatewayInfoRpc>;
  onGatewayInfo?: (cb: (info: GatewayInfoRpc) => void) => () => void;
  extrasProbe?: () => Promise<ExtrasProbe>;
  nodeStart?: (opts: { chain: MinerChain; datadir: string }) => Promise<{ ok: boolean; error?: string }>;
  nodeStop?: () => Promise<{ ok: boolean; error?: string }>;
  nodeStatus?: (opts: { chain: MinerChain; datadir: string }) => Promise<NodeStatusView>;
  gatewayStart?: (opts: {
    chain: MinerChain;
    poolAddress: string;
    poolHost?: string;
    poolPubkey?: string;
    configPath?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  gatewayStop?: () => Promise<{ ok: boolean; error?: string }>;
  gatewayStatus?: (opts: { chain: MinerChain; configPath: string }) => Promise<GatewayStatusView>;
  fetchPrimeKeys?: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
  walletLoad?: (chain: MinerChain) => Promise<string | null>;
  walletSave?: (chain: MinerChain, blob: string) => Promise<{ ok: boolean; error?: string }>;
};

export const HASHER_HOST = new InjectionToken<HasherHost>('HASHER_HOST');
