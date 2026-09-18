import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePoolStatsLine, poolArgv, resolvePoolCli } from './pool.js';

describe('pool CLI resolve and argv', () => {
  it('prefers FEDERATION_POOL_CLI when the file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-pool-cli-'));
    const cli = join(dir, 'cli.js');
    writeFileSync(cli, 'export {}\n');
    expect(resolvePoolCli({ FEDERATION_POOL_CLI: cli }, '/nope', '/nope')).toBe(cli);
  });

  it('builds argv without a cookie and refuses dummy MAIN', () => {
    const argv = poolArgv({
      chain: 'testnet',
      rpc: [{ host: '127.0.0.1', port: 35332, auth: { kind: 'cookie', datadir: '/tmp/x' } }],
      operator: 'tgfcn1qqq',
      feeBps: 200,
      stratumHost: '127.0.0.1',
      stratumPort: 23334,
      datumHost: '127.0.0.1',
      datumPort: 28916,
    });
    expect(argv).toContain('--operator');
    expect(argv).toContain('--datadir');
    expect(argv).toContain('--rpc-endpoints');
    expect(argv).toContain('127.0.0.1:35332');
    expect(argv.join(' ')).not.toMatch(/rpc-user/);
    expect(() =>
      poolArgv({
        chain: 'main',
        rpc: [{ host: '127.0.0.1', port: 4094, auth: { kind: 'cookie', datadir: '/tmp/x' } }],
        operator: 'gfcn1qqq',
        feeBps: 200,
        stratumHost: '127.0.0.1',
        stratumPort: 23334,
        datumHost: '127.0.0.1',
        datumPort: 28916,
      }),
    ).toThrow(/MAIN is not live/);
  });

  it('emits rpc-user flags instead of datadir for username/password', () => {
    const argv = poolArgv({
      chain: 'testnet',
      rpc: [{ host: '10.0.0.9', port: 35332, auth: { kind: 'userpass', user: 'rpcuser', password: 'rpcpass' } }],
      operator: 'tgfcn1qqq',
      feeBps: 200,
      stratumHost: '127.0.0.1',
      stratumPort: 23334,
      datumHost: '127.0.0.1',
      datumPort: 28916,
    });
    expect(argv).toContain('--rpc-user');
    expect(argv).toContain('rpcuser');
    expect(argv).not.toContain('--datadir');
  });

  it('joins an ordered RPC list onto --rpc-endpoints', () => {
    const argv = poolArgv({
      chain: 'testnet',
      rpc: [
        { host: '10.0.0.8', port: 35332, auth: { kind: 'userpass', user: 'rpcuser', password: 'rpcpass' } },
        { host: '10.0.0.9', port: 35332, auth: { kind: 'userpass', user: 'rpcuser', password: 'rpcpass' } },
      ],
      operator: 'tgfcn1qqq',
      feeBps: 200,
      stratumHost: '127.0.0.1',
      stratumPort: 23334,
      datumHost: '127.0.0.1',
      datumPort: 28916,
    });
    expect(argv).toContain('10.0.0.8:35332,10.0.0.9:35332');
  });

  it('parses POOL_STATS lines from the child', () => {
    const s = parsePoolStatsLine('POOL_STATS {"running":true,"chain":"testnet","height":3,"workers":2,"accepted":1,"rejected":0,"lastError":"","status":"ok","stratumPort":23334,"datumPort":28916}');
    expect(s?.workers).toBe(2);
    expect(s?.chain).toBe('testnet');
    expect(s?.payouts).toEqual([]);
    expect(s?.minerNet).toBe('0');
    expect(s?.operatorFee).toBe('0');
    expect(s?.unfilledRemainder).toBe('0');
    expect(parsePoolStatsLine('hello')).toBeNull();
  });

  it('parses TIDES payouts on POOL_STATS', () => {
    const s = parsePoolStatsLine(
      'POOL_STATS {"running":true,"chain":"testnet","height":3,"workers":2,"accepted":1,"rejected":0,"lastError":"","status":"ok","stratumHost":"127.0.0.1","stratumPort":23334,"datumHost":"127.0.0.1","datumPort":28916,"payouts":[{"miner":"tgfcn1abc","sats":"5000000000"}],"minerNet":"246","operatorFee":"4","unfilledRemainder":"750"}',
    );
    expect(s?.payouts).toEqual([{ miner: 'tgfcn1abc', sats: '5000000000' }]);
    expect(s?.minerNet).toBe('246');
    expect(s?.operatorFee).toBe('4');
    expect(s?.unfilledRemainder).toBe('750');
  });

  it('falls back to packaged then sibling paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'fc-pool-res-'));
    mkdirSync(join(root, 'federation-pool'), { recursive: true });
    writeFileSync(join(root, 'federation-pool', 'cli.js'), 'export {}\n');
    expect(resolvePoolCli({}, '/nope', root)).toBe(join(root, 'federation-pool', 'cli.js'));
  });
});
