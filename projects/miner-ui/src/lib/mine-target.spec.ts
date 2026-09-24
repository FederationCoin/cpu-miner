import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isWebStratumKind, isWebStratumMineTo } from './miner-api';
import { applyDesktopStratumTarget, applyWebPoolWssTarget, loopbackBind, storageKey } from './mine-target';

describe('mine-target', () => {
  const store = new Map<string, string>();
  const real = globalThis.localStorage;

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  });

  afterEach(() => {
    if (real) {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real });
    }
  });

  it('maps wildcard binds to loopback', () => {
    expect(isWebStratumKind('stratumPoolWebsocket')).toBe(true);
    expect(isWebStratumKind('datumGatewayWebsocket')).toBe(true);
    expect(isWebStratumKind('stratum')).toBe(false);
    expect(isWebStratumMineTo({ kind: 'stratumPoolWebsocket', url: 'wss://x/stratum', worker: 'a' })).toBe(true);
    expect(isWebStratumMineTo({ kind: 'node', rpc: { host: '127.0.0.1', port: 1, auth: { kind: 'cookie', datadir: '' } }, payout: '' })).toBe(
      false,
    );
    expect(loopbackBind('0.0.0.0')).toBe('127.0.0.1');
    expect(loopbackBind('::')).toBe('127.0.0.1');
    expect(loopbackBind('[::]')).toBe('127.0.0.1');
    expect(loopbackBind('10.0.0.8')).toBe('10.0.0.8');
    expect(storageKey('testnet', 'kind')).toBe('fc.testnet.kind');
  });

  it('writes desktop Stratum and web pool WSS without a house merge', () => {
    applyDesktopStratumTarget('testnet', '0.0.0.0', 23334);
    expect(store.get('fc.testnet.kind')).toBe('stratum');
    expect(store.get('fc.testnet.stratum.host')).toBe('127.0.0.1');
    expect(store.get('fc.testnet.stratum.port')).toBe('23334');
    expect(store.get('fc.testnet.stratum.password')).toBe('x');
    applyWebPoolWssTarget('testnet', ' wss://pool.example.com/stratum ');
    expect(store.get('fc.testnet.kind')).toBe('stratumPoolWebsocket');
    expect(store.get('fc.testnet.stratumPoolWebsocket.url')).toBe('wss://pool.example.com/stratum');
    expect(store.get('fc.testnet.kind')).not.toBe('hostedPoolStratum');
  });
});
