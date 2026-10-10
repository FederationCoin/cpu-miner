import { describe, expect, it } from 'vitest';
import { DEFAULT_REGISTRY_BASE_URL, registryOrigin, registryRequestWithFetch, registryUrl } from './registry-fetch.js';

describe('registry-fetch', () => {
  it('pins https origin mill and rejects traversal', () => {
    expect(registryOrigin({})).toBe(DEFAULT_REGISTRY_BASE_URL);
    expect(registryUrl(DEFAULT_REGISTRY_BASE_URL, '/v1/listings').href).toBe(
      'https://pools.federationcoin.org/v1/listings',
    );
    expect(() => registryUrl(DEFAULT_REGISTRY_BASE_URL, '/v2/listings')).toThrow(/must start with \/v1/);
    expect(() => registryUrl(DEFAULT_REGISTRY_BASE_URL, '/v1/../secret')).toThrow(/not allowed/);
    expect(() => registryUrl('http://pools.federationcoin.org', '/v1/listings')).toThrow(/https/);
  });

  it('sends the chain header and skips CORS', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return {
        status: 200,
        text: async () => JSON.stringify({ items: [] }),
      };
    };
    const out = await registryRequestWithFetch(fetchImpl, DEFAULT_REGISTRY_BASE_URL, {
      method: 'GET',
      path: '/v1/listings',
      chain: 'testnet',
    });
    expect(out.status).toBe(200);
    expect(calls[0]?.url).toBe('https://pools.federationcoin.org/v1/listings');
    expect((calls[0]?.init.headers as Record<string, string>)['X-FederationCoin-Chain']).toBe('testnet');
  });
});
