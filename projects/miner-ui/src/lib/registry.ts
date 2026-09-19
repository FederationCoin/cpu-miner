import canonicalize from 'canonicalize';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { MinerChain } from './chain';
import { CHAINS } from './chain';

export type RegistryConnect =
  | { kind: 'stratumOnly'; stratum: { host: string; port: number }; wss?: { host: string; path: string } }
  | { kind: 'datumOnly'; datum: { host: string; port: number }; wss?: { host: string; path: string } }
  | {
      kind: 'stratumAndDatum';
      stratum: { host: string; port: number };
      datum: { host: string; port: number };
      wss?: { host: string; path: string };
    };

export type AttestConnect =
  | { kind: 'stratum'; host: string; port: number }
  | { kind: 'datum'; host: string; port: number };

export type AttestKind = AttestConnect['kind'];

export type ListingPublic = {
  poolId: string;
  chain: MinerChain;
  operatorWallet: string;
  name: string;
  websiteUrl: string;
  connect: RegistryConnect;
  coinbaseTag: string;
  listingDomain: string;
  attestationCount: number;
  listerConfirmedCoinbasePayee: boolean;
  reviewScore: number;
  hasHostileFlag: boolean;
  metrics?: { hashrate?: number; volatility?: number };
};

export type FindGroup = {
  domain: string;
  listings: ListingPublic[];
  multipleClaims: boolean;
};

export function advertisedAttestKinds(connect: RegistryConnect): AttestKind[] {
  if (connect.kind === 'stratumOnly') {
    return ['stratum'];
  }
  if (connect.kind === 'datumOnly') {
    return ['datum'];
  }
  return ['stratum', 'datum'];
}

export function attestConnectFromListing(connect: RegistryConnect, kind: AttestKind): AttestConnect | undefined {
  if (kind === 'stratum') {
    if (connect.kind === 'datumOnly') {
      return undefined;
    }
    return { kind: 'stratum', host: connect.stratum.host, port: connect.stratum.port };
  }
  if (connect.kind === 'stratumOnly') {
    return undefined;
  }
  return { kind: 'datum', host: connect.datum.host, port: connect.datum.port };
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
