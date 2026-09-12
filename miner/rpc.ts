import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { MinerChain } from './chain.js';
import { RPC_PORT_TESTNET } from './chain.js';

export const RPC_HOST = '127.0.0.1';
export const RPC_PORT = RPC_PORT_TESTNET;

export type RpcAuth = { user: string; password: string };

export type RpcOptions = {
  host?: string;
  port?: number;
  fetchFn?: typeof fetch;
};

/** Windows miner: %LOCALAPPDATA%\FederationCoin. Else ~/.federationcoin. */
export function defaultDatadir(): string {
  const env = process.env.FEDERATIONCOIN_DATADIR?.trim();
  if (env) {
    return env;
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA?.trim();
    if (local) {
      return join(local, 'FederationCoin');
    }
  }
  return join(homedir(), '.federationcoin');
}

export function parseHost(raw: string): string {
  const host = raw.trim();
  if (!host) {
    throw new Error('host is empty');
  }
  if (/[\s/?#]/.test(host)) {
    throw new Error('bad host');
  }
  if (host.includes(':') && !host.startsWith('[') && host.split(':').length === 2) {
    throw new Error('bad host');
  }
  return host;
}

export function parsePort(raw: number | string): number {
  const port = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`bad port ${raw}`);
  }
  return port;
}

/**
 * Main: <datadir>/.cookie.
 * Testnet: <datadir>/testnet3/.cookie, or .cookie if datadir is already testnet3.
 */
export function cookiePathForDatadir(datadir: string, chain: MinerChain): string {
  const d = datadir.trim().replace(/[/\\]+$/, '');
  if (chain === 'main') {
    return join(d, '.cookie');
  }
  const nested = join(d, 'testnet3', '.cookie');
  const direct = join(d, '.cookie');
  if (existsSync(direct) && (basename(d) === 'testnet3' || !existsSync(nested))) {
    return direct;
  }
  return nested;
}

export function cookiePath(datadir = defaultDatadir(), chain: MinerChain = 'testnet'): string {
  return cookiePathForDatadir(datadir, chain);
}

export function loadCookie(path = cookiePath()): RpcAuth {
  let line: string;
  try {
    line = readFileSync(path, 'utf8').split('\n')[0] ?? '';
  } catch {
    throw new Error(`no cookie at ${path} (set Node data directory)`);
  }
  if (line.endsWith('\r')) {
    line = line.slice(0, -1);
  }
  const colon = line.indexOf(':');
  if (colon < 0) {
    throw new Error(`bad cookie ${path}`);
  }
  return { user: line.slice(0, colon), password: line.slice(colon + 1) };
}

function httpOrigin(host: string, port: number): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `http://[${host}]:${port}`;
  }
  return `http://${host}:${port}`;
}

export async function rpcCall(
  auth: RpcAuth,
  method: string,
  params: unknown[],
  options: RpcOptions = {},
): Promise<unknown> {
  const host = parseHost(options.host ?? RPC_HOST);
  const port = parsePort(options.port ?? RPC_PORT);
  const body = JSON.stringify({ jsonrpc: '1.0', id: 'fc', method, params });
  const fetchFn = options.fetchFn ?? fetch;
  const token = Buffer.from(`${auth.user}:${auth.password}`, 'utf8').toString('base64');
  let res: Response;
  try {
    res = await fetchFn(`${httpOrigin(host, port)}/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(`ECONNREFUSED ${host}:${port} (${cause})`);
  }
  return parseRpcResponse(await res.text(), res.status);
}

function parseRpcResponse(text: string, status: number): unknown {
  let json: { error?: unknown; result?: unknown };
  try {
    json = JSON.parse(text) as { error?: unknown; result?: unknown };
  } catch {
    throw new Error(`rpc HTTP ${status}: ${text.slice(0, 200)}`);
  }
  if (json.error != null) {
    throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error));
  }
  return json.result;
}
