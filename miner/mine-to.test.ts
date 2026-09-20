import { describe, expect, it } from 'vitest';
import { connectHost, parseMineTo, parseRpcConnect } from './mine-to.js';

function cookieRpc(datadir: string, host = '127.0.0.1', port = 35332) {
  return { host, port, auth: { kind: 'cookie' as const, datadir } };
}

describe('connectHost', () => {
  it('maps wildcard binds to loopback', () => {
    expect(connectHost('0.0.0.0')).toBe('127.0.0.1');
    expect(connectHost('::')).toBe('127.0.0.1');
    expect(connectHost('10.0.0.8')).toBe('10.0.0.8');
  });
});

describe('parseRpcConnect', () => {
  it('defaults to cookie auth', () => {
    expect(parseRpcConnect({ host: '127.0.0.1', port: 35332 }, 'testnet')).toEqual(cookieRpc(''));
  });

  it('parses username/password without a datadir', () => {
    expect(
      parseRpcConnect({ host: '10.0.0.9', port: 35332, auth: { kind: 'userpass', user: 'rpcuser', password: 'rpcpass' } }, 'testnet'),
    ).toEqual({
      host: '10.0.0.9',
      port: 35332,
      auth: { kind: 'userpass', user: 'rpcuser', password: 'rpcpass' },
    });
  });

  it('rejects empty username and unknown auth kinds', () => {
    expect(() => parseRpcConnect({ host: '127.0.0.1', port: 35332, auth: { kind: 'userpass', user: '  ' } }, 'testnet')).toThrow(
      /RPC username is empty/,
    );
    expect(() => parseRpcConnect({ host: '127.0.0.1', port: 35332, auth: { kind: 'token' } }, 'testnet')).toThrow(/unknown RPC auth kind/);
  });
});

describe('parseMineTo', () => {
  it('parses node and stratum', () => {
    expect(parseMineTo({ kind: 'node', rpc: cookieRpc('/tmp/x'), payout: 'tgfcn1qqq' }, 'testnet').kind).toBe('node');
    const s = parseMineTo(
      { kind: 'stratum', stratum: { host: '127.0.0.1', port: 23334, worker: 'tgfcn1abc.cpu', password: 'x' } },
      'testnet',
    );
    expect(s.kind).toBe('stratum');
  });

  it('rejects empty workers, DATUM kinds, and unknown kinds', () => {
    expect(() => parseMineTo({ kind: 'stratum', stratum: { host: '127.0.0.1', port: 23334, worker: '  ' } }, 'testnet')).toThrow(
      /worker is empty/,
    );
    expect(() => parseMineTo({ kind: 'rpc' }, 'testnet')).toThrow(/unknown mineTo kind/);
    expect(() => parseMineTo({ kind: 'datum', datum: { host: '10.0.0.8', port: 28916, worker: 'tgfcn1abc.cpu' } }, 'testnet')).toThrow(
      /unknown mineTo kind/,
    );
    expect(() => parseMineTo({ kind: 'appPoolStratum', worker: 'tgfcn1abc.cpu', password: 'x' }, 'testnet')).toThrow(
      /unknown mineTo kind/,
    );
    expect(() =>
      parseMineTo({ kind: 'hostedPoolStratum', worker: 'tgfcn1abc.cpu', password: 'x' }, 'testnet'),
    ).toThrow(/unknown mineTo kind/);
  });
});
