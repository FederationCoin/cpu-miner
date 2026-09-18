import { InjectionToken } from '@angular/core';
import type { GpuScan, MinerInfo, MinerStartOpts, MinerStats, PoolStartOpts, PoolStats } from './miner-api';
import type { RegistryRequest, RegistryResponse } from './registry';

export type HasherHost = {
  canMine: boolean;
  inElectron: boolean;
  start: (opts: MinerStartOpts) => Promise<{ ok: boolean; error?: string }>;
  stop: () => Promise<void>;
  info: () => Promise<MinerInfo | null>;
  gpus: () => Promise<GpuScan>;
  pickDatadir: () => Promise<string | null>;
  onStats: (cb: (s: MinerStats) => void) => () => void;
  onToast: (cb: (message: string) => void) => () => void;
  poolStart: (opts: PoolStartOpts) => Promise<{ ok: boolean; error?: string }>;
  poolStop: () => Promise<void>;
  onPoolStats: (cb: (s: PoolStats) => void) => () => void;
  registryRequest?: (req: RegistryRequest) => Promise<RegistryResponse>;
};

export const HASHER_HOST = new InjectionToken<HasherHost>('HASHER_HOST');
