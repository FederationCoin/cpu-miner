import { MAIN_IS_LIVE, defaultRpcPort, parseChain, STRATUM_PORT_DEFAULT, type MinerChain } from './chain.js';
import { parseHost, parsePort } from './rpc.js';
import type { GpuPick } from './gpu-pick.js';

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
  | { kind: 'appPoolDatum'; worker: string; rpc: RpcConnect };

export type MineToKind = MineTo['kind'];

export type MinerStartOpts = {
  chain: MinerChain;
  threads: number;
  gpus?: GpuPick[];
  mineTo: MineTo;
};

export const DATUM_PORT_DEFAULT = 28916;

export function isAppPoolKind(kind: MineToKind): boolean {
  return kind === 'appPoolStratum' || kind === 'appPoolDatum';
}

export function connectHost(bind: string): string {
  const h = bind.trim();
  if (h === '0.0.0.0' || h === '::' || h === '[::]') {
    return '127.0.0.1';
  }
  return parseHost(h);
}

export function parseRpcConnect(raw: unknown, chain: MinerChain): RpcConnect {
  if (!raw || typeof raw !== 'object') {
    throw new Error('rpc is required');
  }
  const rpc = raw as {
    host?: unknown;
    port?: unknown;
    auth?: { kind?: unknown; datadir?: unknown; user?: unknown; password?: unknown };
  };
  const host = parseHost(String(rpc.host ?? '127.0.0.1'));
  const port = parsePort((rpc.port as number | string | undefined) ?? defaultRpcPort(chain));
  const auth = rpc.auth;
  if (auth?.kind === 'userpass') {
    const user = String(auth.user ?? '').trim();
    if (!user) {
      throw new Error('RPC username is empty');
    }
    return { host, port, auth: { kind: 'userpass', user, password: String(auth.password ?? '') } };
  }
  if (auth?.kind && auth.kind !== 'cookie') {
    throw new Error('unknown RPC auth kind');
  }
  return { host, port, auth: { kind: 'cookie', datadir: String(auth?.datadir ?? '').trim() } };
}

export function parseMineTo(raw: unknown, chain: MinerChain): MineTo {
  if (!raw || typeof raw !== 'object') {
    throw new Error('mineTo is required');
  }
  const rec = raw as { kind?: unknown };
  if (rec.kind === 'node') {
    const node = raw as { rpc?: unknown; payout?: unknown };
    return {
      kind: 'node',
      rpc: parseRpcConnect(node.rpc ?? {}, chain),
      payout: String(node.payout ?? '').trim(),
    };
  }
  if (rec.kind === 'stratum') {
    const s = (raw as { stratum?: Partial<StratumConnect> }).stratum ?? {};
    const worker = String(s.worker ?? '').trim();
    if (!worker) {
      throw new Error('worker is empty');
    }
    return {
      kind: 'stratum',
      stratum: {
        host: parseHost(s.host ?? '127.0.0.1'),
        port: parsePort(s.port ?? STRATUM_PORT_DEFAULT),
        worker,
        password: String(s.password ?? 'x'),
      },
    };
  }
  if (rec.kind === 'datum') {
    const d = (raw as { datum?: Partial<DatumConnect> }).datum ?? {};
    const worker = String(d.worker ?? '').trim();
    if (!worker) {
      throw new Error('worker is empty');
    }
    return {
      kind: 'datum',
      datum: {
        host: parseHost(d.host ?? '127.0.0.1'),
        port: parsePort(d.port ?? DATUM_PORT_DEFAULT),
        worker,
        rpc: parseRpcConnect(d.rpc ?? {}, chain),
      },
    };
  }
  if (rec.kind === 'appPoolStratum') {
    const worker = String((raw as { worker?: unknown }).worker ?? '').trim();
    if (!worker) {
      throw new Error('worker is empty');
    }
    if (chain === 'main' && !MAIN_IS_LIVE) {
      throw new Error('MAIN is not live; mine the app pool on testnet');
    }
    return {
      kind: 'appPoolStratum',
      worker,
      password: String((raw as { password?: unknown }).password ?? 'x'),
    };
  }
  if (rec.kind === 'appPoolDatum') {
    const worker = String((raw as { worker?: unknown }).worker ?? '').trim();
    if (!worker) {
      throw new Error('worker is empty');
    }
    if (chain === 'main' && !MAIN_IS_LIVE) {
      throw new Error('MAIN is not live; mine the app pool on testnet');
    }
    return { kind: 'appPoolDatum', worker, rpc: parseRpcConnect((raw as { rpc?: unknown }).rpc ?? {}, chain) };
  }
  throw new Error('unknown mineTo kind');
}
