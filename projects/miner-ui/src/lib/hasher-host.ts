import { InjectionToken } from '@angular/core';
import type { GpuScan, MinerInfo, MinerStartOpts, MinerStats, MinerToast, PoolStartOpts, PoolStats } from './miner-api';
import type { RegistryRequest, RegistryResponse } from './registry';
import type { GatewayPoolInfoRpc } from './stratum-ws';

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
  requestGatewayPoolInfo?: () => boolean;
  fetchGatewayPoolInfo?: (url: string) => Promise<GatewayPoolInfoRpc>;
  onGatewayPoolInfo?: (cb: (info: GatewayPoolInfoRpc) => void) => () => void;
};

export const HASHER_HOST = new InjectionToken<HasherHost>('HASHER_HOST');
