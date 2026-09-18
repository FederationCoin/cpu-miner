import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAIN_IS_LIVE, parseChain, type MinerChain } from './chain.js';
import { parseRpcConnect, type RpcConnect } from './mine-to.js';
import { parseHost, parsePort } from './rpc.js';

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
  stratumHost: '',
  stratumPort: 0,
  datumHost: '',
  datumPort: 0,
  payouts: [],
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

export function rpcEndpointArg(rpc: { host: string; port: number }): string {
  const host = rpc.host.startsWith('[') || !rpc.host.includes(':') ? rpc.host : `[${rpc.host}]`;
  return `${host}:${rpc.port}`;
}

export function poolArgv(opts: PoolStartOpts): string[] {
  const chain = parseChain(opts.chain);
  if (chain === 'main' && !MAIN_IS_LIVE) {
    throw new Error('MAIN is not live; host a pool on testnet');
  }
  if (!Array.isArray(opts.rpc) || opts.rpc.length === 0) {
    throw new Error('rpc list is empty');
  }
  const parsed = opts.rpc.map((r) => parseRpcConnect(r, chain));
  const auth0 = parsed[0].auth;
  for (const r of parsed) {
    if (JSON.stringify(r.auth) !== JSON.stringify(auth0)) {
      throw new Error('every RPC node uses the same cookie or the same username/password');
    }
  }
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
  const args = [
    '--chain',
    chain,
    '--rpc-endpoints',
    parsed.map((r) => rpcEndpointArg(r)).join(','),
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
  if (auth0.kind === 'cookie') {
    args.push('--datadir', auth0.datadir);
  } else {
    args.push('--rpc-user', auth0.user, '--rpc-password', auth0.password);
  }
  return args;
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
    return { ...rec, payouts: normalizePayouts(rec.payouts) };
  } catch {
    return null;
  }
}

function normalizePayouts(raw: unknown): TidesPayout[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: TidesPayout[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const miner = (item as { miner?: unknown }).miner;
    const sats = (item as { sats?: unknown }).sats;
    if (typeof miner !== 'string' || !miner) {
      continue;
    }
    if (typeof sats === 'string' && sats.length > 0) {
      out.push({ miner, sats });
    } else if (typeof sats === 'number' && Number.isFinite(sats)) {
      out.push({ miner, sats: String(Math.trunc(sats)) });
    }
  }
  return out;
}

export function poolCliDir(cliPath: string): string {
  return dirname(cliPath);
}
