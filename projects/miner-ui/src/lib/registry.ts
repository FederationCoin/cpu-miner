import canonicalize from 'canonicalize';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { MinerChain } from './chain';
import { CHAINS } from './chain';

export const MaxPoolConnections = 12;
export const MaxPoolConnectionsPerKind = 3;

export const ConnectionKinds = ['stratum', 'stratumWs', 'datumPrime', 'datumPrimeWs'] as const;
export const RegisterConnectionKinds = ['stratum', 'stratumWs', 'datumPrime'] as const;
export type ConnectionKind = (typeof ConnectionKinds)[number];
export type PoolConnection = { kind: ConnectionKind; url: string; identityPubkey?: string; keysUrl?: string };

/** Old listings until operators re-save. */
export type RegistryConnect =
  | { kind: 'stratumOnly'; stratum: { host: string; port: number }; wss?: { host: string; path: string } }
  | { kind: 'datumOnly'; datum: { host: string; port: number }; wss?: { host: string; path: string } }
  | {
      kind: 'stratumAndDatum';
      stratum: { host: string; port: number };
      datum: { host: string; port: number };
      wss?: { host: string; path: string };
    };

export type AttestConnect = PoolConnection;

export type ListingPublic = {
  poolId: string;
  chain: MinerChain;
  operatorWallet: string;
  name: string;
  websiteUrl: string;
  connections?: PoolConnection[];
  connect?: RegistryConnect;
  coinbaseTag: string;
  listingDomain: string;
  attestationCount: number;
  listerConfirmedCoinbasePayee: boolean;
  reviewScore: number;
  hasHostileFlag: boolean;
  metrics?: { hashrate?: number; volatility?: number };
  attestedByYou?: PoolConnection;
};

export type FindGroup = {
  domain: string;
  listings: ListingPublic[];
  multipleClaims: boolean;
};

export const ConnectionKindLabel: Record<ConnectionKind, string> = {
  stratum: 'Stratum',
  stratumWs: 'Stratum WS',
  datumPrime: 'DATUM Prime Pool',
  datumPrimeWs: 'DATUM Prime Pool WS',
};

export const ConnectionKindPlaceholder: Record<ConnectionKind, string> = {
  stratum: 'stratum.example.org:3333',
  stratumWs: 'wss://stratum.example.org/stratum',
  datumPrime: 'prime.example.org:28916',
  datumPrimeWs: 'wss://prime.example.org/datum',
};

export function connectionsFromLegacy(connect?: RegistryConnect): PoolConnection[] {
  if (!connect) {
    return [];
  }
  const out: PoolConnection[] = [];
  if (connect.kind === 'stratumOnly' || connect.kind === 'stratumAndDatum') {
    out.push({ kind: 'stratum', url: `${connect.stratum.host}:${connect.stratum.port}` });
  }
  if (connect.kind === 'datumOnly' || connect.kind === 'stratumAndDatum') {
    out.push({ kind: 'datumPrime', url: `${connect.datum.host}:${connect.datum.port}` });
  }
  if (connect.wss) {
    out.push({ kind: 'stratumWs', url: `wss://${connect.wss.host}${connect.wss.path}` });
  }
  return out;
}

export function listingConnections(p: Pick<ListingPublic, 'connections' | 'connect'>): PoolConnection[] {
  if (p.connections && p.connections.length > 0) {
    return p.connections;
  }
  return connectionsFromLegacy(p.connect);
}

export function listingCanMineThis(p: Pick<ListingPublic, 'connections' | 'connect'>, web: boolean): boolean {
  const cs = listingConnections(p);
  return web ? cs.some((c) => c.kind === 'stratumWs') : cs.some((c) => c.kind === 'stratum');
}

export function listingMineUrl(p: Pick<ListingPublic, 'connections' | 'connect'>, web: boolean): string | null {
  const cs = listingConnections(p);
  const hit = web ? cs.find((c) => c.kind === 'stratumWs') : cs.find((c) => c.kind === 'stratum');
  return hit?.url ?? null;
}

export function listingPrimeConnections(p: Pick<ListingPublic, 'connections' | 'connect'>): PoolConnection[] {
  return listingConnections(p).filter((c) => c.kind === 'datumPrime' || c.kind === 'datumPrimeWs');
}

export function connectionEquals(a: PoolConnection, b: PoolConnection): boolean {
  return a.kind === b.kind && a.url.trim().toLowerCase() === b.url.trim().toLowerCase();
}

export function canAddPoolConnection(rows: PoolConnection[], kind: ConnectionKind): boolean {
  if (rows.length >= MaxPoolConnections) {
    return false;
  }
  return rows.filter((r) => r.kind === kind).length < MaxPoolConnectionsPerKind;
}

export function splitHostPort(url: string): { host: string; port: number } | null {
  const i = url.lastIndexOf(':');
  if (i <= 0) {
    return null;
  }
  const host = url.slice(0, i).trim();
  const port = Number(url.slice(i + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return { host, port };
}

export type RegistryRequest = {
  method: string;
  path: string;
  chain: MinerChain;
  body?: unknown;
  authorization?: string;
};

export type RegistryResponse = { status: number; json: unknown };

export function payloadHashHex(command: unknown): string {
  const jcs = canonicalize(command);
  if (!jcs) {
    throw new Error('cannot canonicalize');
  }
  return bytesToHex(sha256(new TextEncoder().encode(jcs)));
}

export function signedPayloadHash(
  command: unknown,
  signingBlockHeight: number,
  signingBlockHash: string,
): string {
  return payloadHashHex({ command, signingBlockHeight, signingBlockHash });
}

export function envelopeAuthorization(env: object): string {
  const json = JSON.stringify(env);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  const b64 = btoa(bin);
  return 'Bearer ' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function sparrowSignatureToBase64Url(raw: string): string {
  return raw.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function registryFetch(
  req: RegistryRequest,
  baseUrl: string,
  transport?: (r: RegistryRequest) => Promise<RegistryResponse>,
): Promise<RegistryResponse> {
  if (transport) {
    return transport(req);
  }
  const headers: Record<string, string> = {
    'X-FederationCoin-Chain': req.chain,
  };
  if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (req.authorization) {
    headers['Authorization'] = req.authorization;
  }
  const res = await fetch(`${baseUrl}${req.path}`, {
    method: req.method,
    headers,
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });
  let json: unknown;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { title: text };
    }
  }
  return { status: res.status, json };
}

export function mainFinderLive(chain: MinerChain): boolean {
  return chain !== 'main' || CHAINS.main.mainIsLive;
}
