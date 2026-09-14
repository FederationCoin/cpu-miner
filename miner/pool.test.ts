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
      rpcHost: '127.0.0.1',
      rpcPort: 35332,
      datadir: '/tmp/x',
      operator: 'tgfcn1qqq',
      feeBps: 200,
      stratumHost: '127.0.0.1',
      stratumPort: 23334,
      datumHost: '127.0.0.1',
      datumPort: 28916,
    });
    expect(argv).toContain('--operator');
    expect(argv.join(' ')).not.toMatch(/cookie/i);
    expect(() =>
      poolArgv({
        chain: 'main',
        rpcHost: '127.0.0.1',
        rpcPort: 4094,
        datadir: '/tmp/x',
        operator: 'gfcn1qqq',
        feeBps: 200,
        stratumHost: '127.0.0.1',
        stratumPort: 23334,
        datumHost: '127.0.0.1',
        datumPort: 28916,
      }),
    ).toThrow(/MAIN is not live/);
  });

  it('parses POOL_STATS lines from the child', () => {
    const s = parsePoolStatsLine('POOL_STATS {"running":true,"chain":"testnet","height":3,"workers":2,"accepted":1,"rejected":0,"lastError":"","status":"ok","stratumPort":23334,"datumPort":28916}');
    expect(s?.workers).toBe(2);
    expect(s?.chain).toBe('testnet');
    expect(parsePoolStatsLine('hello')).toBeNull();
  });

  it('falls back to packaged then sibling paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'fc-pool-res-'));
    mkdirSync(join(root, 'federation-pool'), { recursive: true });
    writeFileSync(join(root, 'federation-pool', 'cli.js'), 'export {}\n');
    expect(resolvePoolCli({}, '/nope', root)).toBe(join(root, 'federation-pool', 'cli.js'));
  });
});
