import { describe, expect, it } from 'vitest';
import { APP_DEFAULTS, WEB_DEFAULTS } from './defaults';

describe('miner defaults JSON', () => {
  it('web testnet Stratum is the WSS host on 443', () => {
    expect(WEB_DEFAULTS.chains.testnet.stratum).toEqual({
      host: 'pool.testnet.federationcoin.org',
      port: 443,
      password: 'x',
    });
    expect(WEB_DEFAULTS.hosted.stratumWss).toBe('wss://pool.testnet.federationcoin.org/stratum');
    expect(WEB_DEFAULTS.chains.testnet.mineToKind).toBe('hostedPoolStratum');
  });

  it('app testnet Stratum is loopback TCP 23334', () => {
    expect(APP_DEFAULTS.chains.testnet.stratum).toEqual({
      host: '127.0.0.1',
      port: 23334,
      password: 'x',
    });
    expect(APP_DEFAULTS.chains.testnet.mineToKind).toBe('node');
    expect(APP_DEFAULTS.chains.testnet.pool.stratumPort).toBe(23334);
  });
});
