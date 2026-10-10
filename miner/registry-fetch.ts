/** Main-process registry HTTP. Skips renderer CORS. Origin mill only. */

export const DEFAULT_REGISTRY_BASE_URL = 'https://pools.federationcoin.org';

export type RegistryFetchReq = {
  method: string;
  path: string;
  chain: 'main' | 'testnet';
  body?: unknown;
  authorization?: string;
};

export type RegistryFetchRes = { status: number; json: unknown };

export function registryOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.REGISTRY_BASE_URL?.trim() || DEFAULT_REGISTRY_BASE_URL;
  return raw.replace(/\/$/, '');
}

export function registryUrl(baseUrl: string, path: string): URL {
  if (!path.startsWith('/v1')) {
    throw new Error('registry path must start with /v1');
  }
  if (path.includes('..') || path.includes('\\') || path.includes('://')) {
    throw new Error('registry path is not allowed');
  }
  const base = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`);
  if (base.protocol !== 'https:') {
    throw new Error('registry must be https');
  }
  return new URL(path, `${base.origin}/`);
}

type RegistryHttp = (url: string, init?: RequestInit) => Promise<{ status: number; text: () => Promise<string> }>;

export async function registryRequestWithFetch(
  fetchImpl: RegistryHttp,
  baseUrl: string,
  req: RegistryFetchReq,
): Promise<RegistryFetchRes> {
  if (req.chain !== 'main' && req.chain !== 'testnet') {
    throw new Error('chain must be main or testnet');
  }
  const method = req.method.toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error('registry method is not allowed');
  }
  const url = registryUrl(baseUrl, req.path);
  const headers: Record<string, string> = {
    'X-FederationCoin-Chain': req.chain,
  };
  if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (req.authorization) {
    headers.Authorization = req.authorization;
  }
  const res = await fetchImpl(url.href, {
    method,
    headers,
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { title: text };
    }
  }
  return { status: res.status, json };
}
