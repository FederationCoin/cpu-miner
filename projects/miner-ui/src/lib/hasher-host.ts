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

export const HASHER_HOST = new InjectionToken<HasherHost>('HASHER_HOST');
