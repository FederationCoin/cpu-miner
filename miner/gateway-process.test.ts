import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canStopGateway, gatewayCommand, gatewayConfig, spawnGateway, writeGatewayConfig, type GatewaySession } from './gateway-process.js';
import type { ChildProcess } from 'node:child_process';

const base = {
  chain: 'testnet' as const,
  rpcUrl: 'http://127.0.0.1:35332',
  rpcUser: 'u',
  rpcPassword: 'p',
  poolHost: '',
  poolPubkey: '',
  configPath: '',
};

describe('gateway-process', () => {
  it('writes solo config with empty pool_host and loopback WSS', () => {
    const cfg = gatewayConfig(base) as {
      datum: { pool_host: string; pool_pubkey: string; pool_pass_workers: boolean; pool_pass_full_users: boolean };
      stratum: { ws_listen_addr: string; ws_listen_port: number };
    };
    expect(cfg.datum.pool_host).toBe('');
    expect(cfg.datum.pool_pubkey).toBe('');
    expect(cfg.datum.pool_pass_workers).toBe(false);
    expect(cfg.datum.pool_pass_full_users).toBe(false);
    expect(cfg.stratum.ws_listen_addr).toBe('127.0.0.1');
    expect(cfg.stratum.ws_listen_port).toBe(23335);
    const lan = gatewayConfig({ ...base, listenReach: 'network' }) as {
      stratum: { listen_addr: string; ws_listen_addr: string };
      bitcoind: { rpcurl: string };
    };
    expect(lan.stratum.listen_addr).toBe('0.0.0.0');
    expect(lan.stratum.ws_listen_addr).toBe('0.0.0.0');
    expect(lan.bitcoind.rpcurl).toBe('http://127.0.0.1:35332');
    expect(gatewayCommand('/usr/bin/datum_gateway', '/tmp/g.json')).toBe('/usr/bin/datum_gateway -c /tmp/g.json');
    expect(gatewayCommand('  ', '/tmp/g.json')).toBe('');
  });

  it('keeps an opt-in House Prime host when set', () => {
    const cfg = gatewayConfig({ ...base, poolHost: 'datum.testnet.federationcoin.org:28916', poolPubkey: 'aa' }) as {
      datum: { pool_host: string; pool_pubkey: string };
    };
    expect(cfg.datum.pool_host).toBe('datum.testnet.federationcoin.org:28916');
    expect(cfg.datum.pool_pubkey).toBe('aa');
  });

  it('refuses dummy MAIN', () => {
    expect(() => gatewayConfig({ ...base, chain: 'main' })).toThrow(/MAIN is not live/);
  });

  it('Stop is only for spawned sessions', () => {
    const spawned: GatewaySession = { kind: 'spawned', child: {} as ChildProcess, chain: 'testnet' };
    expect(canStopGateway({ kind: 'idle' })).toBe(false);
    expect(canStopGateway(spawned)).toBe(true);
  });

  it('writes JSON without printing the cookie password to stdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-gw-'));
    const configPath = join(dir, 'testnet.json');
    writeGatewayConfig({ ...base, configPath });
    const body = readFileSync(configPath, 'utf8');
    expect(body).toContain('"rpcpassword": "p"');
    expect(body).toContain('"pool_host": ""');
    expect(body).not.toContain('pool_address');
    expect(() => spawnGateway({ kind: 'missing' }, { ...base, configPath })).toThrow(/addon/);
    const child = spawnGateway({ kind: 'present', path: process.execPath }, { ...base, configPath });
    expect(child.pid).toBeTruthy();
    child.kill();
  });
});
