import { describe, expect, it } from 'vitest';
import { APP_DEFAULTS, WEB_DEFAULTS } from './defaults';

describe('miner defaults JSON', () => {
  it('web testnet MineTo is pool WebSocket with an empty URL', () => {
    expect(WEB_DEFAULTS.chains.testnet.mineToKind).toBe('stratumPoolWebsocket');
    expect(WEB_DEFAULTS.chains.testnet.stratumPoolWebsocket).toEqual({ url: '' });
    expect(WEB_DEFAULTS.chains.testnet.datumGatewayWebsocket).toEqual({ url: '' });
    expect(WEB_DEFAULTS.hosted.stratumWss).toBe('wss://pool.testnet.federationcoin.org/stratum');
    expect(WEB_DEFAULTS.registryBaseUrl).toBe('https://pools.federationcoin.org');
  });

  it('app testnet Stratum is loopback TCP 23334', () => {
    expect(APP_DEFAULTS.chains.testnet.stratum).toEqual({
      host: '127.0.0.1',
      port: 23334,
      password: 'x',
    });
    expect(APP_DEFAULTS.chains.testnet.mineToKind).toBe('node');
    expect(APP_DEFAULTS.chains.testnet.pool.stratumPort).toBe(23334);
    expect(APP_DEFAULTS.registryBaseUrl).toBe('https://pools.federationcoin.org');
  });
});
