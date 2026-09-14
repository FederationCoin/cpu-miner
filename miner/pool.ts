import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAIN_IS_LIVE, parseChain, type MinerChain } from './chain.js';
import { parseHost, parsePort } from './rpc.js';

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

export const IDLE_POOL_STATS: PoolStats = {
  running: false,
  chain: null,
  height: 0,
  workers: 0,
  accepted: 0,
  rejected: 0,
  lastError: '',
  status: 'idle',
  stratumPort: 0,
  datumPort: 0,
};

export function resolvePoolCli(env: NodeJS.ProcessEnv, here: string, resourcesPath: string): string | null {
  const fromEnv = env.FEDERATION_POOL_CLI?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }
  const packaged = join(resourcesPath, 'federation-pool', 'cli.js');
  if (existsSync(packaged)) {
    return packaged;
  }
  const vendor = join(here, '../vendor/federation-pool/cli.js');
  if (existsSync(vendor)) {
    return vendor;
  }
  const sibling = join(here, '../../federation-pool/dist/cli.js');
  if (existsSync(sibling)) {
    return sibling;
  }
  return null;
}

export function poolArgv(opts: PoolStartOpts): string[] {
  const chain = parseChain(opts.chain);
  if (chain === 'main' && !MAIN_IS_LIVE) {
    throw new Error('MAIN is not live; host a pool on testnet');
  }
  parseHost(opts.rpcHost);
  parsePort(opts.rpcPort);
  parseHost(opts.stratumHost);
  parsePort(opts.stratumPort);
  parseHost(opts.datumHost);
  parsePort(opts.datumPort);
  if (!(opts.operator ?? '').trim()) {
    throw new Error('operator address is empty');
  }
  const fee = opts.feeBps | 0;
  if (fee < 0 || fee > 10000) {
    throw new Error('fee bps must be 0..10000');
  }
  return [
    '--chain',
    chain,
    '--rpc-host',
    opts.rpcHost.trim(),
    '--rpc-port',
    String(opts.rpcPort),
    '--datadir',
    opts.datadir.trim(),
    '--operator',
    opts.operator.trim(),
    '--fee-bps',
    String(fee),
    '--stratum-bind',
    opts.stratumHost.trim(),
    '--stratum-port',
    String(opts.stratumPort),
    '--datum-bind',
    opts.datumHost.trim(),
    '--datum-port',
    String(opts.datumPort),
  ];
}

export function parsePoolStatsLine(line: string): PoolStats | null {
  const prefix = 'POOL_STATS ';
  if (!line.startsWith(prefix)) {
    return null;
  }
  try {
    const rec = JSON.parse(line.slice(prefix.length)) as PoolStats;
    if (typeof rec.running !== 'boolean') {
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

export function poolCliDir(cliPath: string): string {
  return dirname(cliPath);
}
