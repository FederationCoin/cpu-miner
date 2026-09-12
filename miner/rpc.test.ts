import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { cookiePathForDatadir, defaultDatadir, parseHost, parsePort, rpcCall } from './rpc.js';

describe('datadir / cookie path', () => {
  it('defaults to ~/.federationcoin on non-Windows', () => {
    delete process.env.FEDERATIONCOIN_DATADIR;
    const d = defaultDatadir();
    expect(d).toBe(join(homedir(), '.federationcoin'));
    expect(d).not.toContain('AppData');
  });

  it('uses testnet3/.cookie under a top-level datadir', () => {
    const root = mkdtempSync(join(tmpdir(), 'fc-datadir-'));
    mkdirSync(join(root, 'testnet3'));
    writeFileSync(join(root, 'testnet3', '.cookie'), '__cookie__:x');
    expect(cookiePathForDatadir(root, 'testnet')).toBe(join(root, 'testnet3', '.cookie'));
  });

  it('uses .cookie when datadir is already testnet3', () => {
    const root = mkdtempSync(join(tmpdir(), 'fc-tn3-'));
    const tn = join(root, 'testnet3');
    mkdirSync(tn);
    writeFileSync(join(tn, '.cookie'), '__cookie__:x');
    expect(cookiePathForDatadir(tn, 'testnet')).toBe(join(tn, '.cookie'));
  });

  it('uses datadir/.cookie on main even when testnet3 exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'fc-main-'));
    mkdirSync(join(root, 'testnet3'));
    writeFileSync(join(root, 'testnet3', '.cookie'), '__cookie__:tn');
    writeFileSync(join(root, '.cookie'), '__cookie__:main');
    expect(cookiePathForDatadir(root, 'main')).toBe(join(root, '.cookie'));
  });
});

describe('parseHost / parsePort', () => {
  it('accepts a hostname or IPv4', () => {
    expect(parseHost('127.0.0.1')).toBe('127.0.0.1');
    expect(parseHost(' pool.example ')).toBe('pool.example');
  });

  it('rejects empty, spaced, or host:port', () => {
    expect(() => parseHost('')).toThrow(/empty/);
    expect(() => parseHost('a b')).toThrow(/bad host/);
    expect(() => parseHost('127.0.0.1:35332')).toThrow(/bad host/);
  });

  it('accepts IPv6', () => {
    expect(parseHost('::1')).toBe('::1');
  });

  it('accepts ports 1-65535', () => {
    expect(parsePort(35332)).toBe(35332);
    expect(parsePort('23334')).toBe(23334);
    expect(() => parsePort(0)).toThrow(/bad port/);
    expect(() => parsePort(70000)).toThrow(/bad port/);
  });
});

const auth = { user: '__cookie__', password: 'secret-not-logged' };

describe('rpcCall', () => {
  it('uses fetch only and does not spawn curl', async () => {
    const src = readFileSync(new URL('./rpc.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/curl/i);
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/isWsl|WIN_CURL|windows-loopback/);
    const fetchFn = vi.fn().mockRejectedValue(new Error('fetch failed'));
    await expect(
      rpcCall(auth, 'getblocktemplate', [{}], { host: '10.0.0.5', port: 35332, fetchFn }),
    ).rejects.toThrow(/ECONNREFUSED 10\.0\.0\.5:35332/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = fetchFn.mock.calls[0]![0] as string;
    expect(url).toBe('http://10.0.0.5:35332/');
  });

  it('brackets IPv6 in the RPC URL', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('fetch failed'));
    await expect(rpcCall(auth, 'getblocktemplate', [{}], { host: '::1', port: 35332, fetchFn })).rejects.toThrow(
      /ECONNREFUSED/,
    );
    expect(fetchFn.mock.calls[0]![0]).toBe('http://[::1]:35332/');
  });

  it('does not treat an RPC JSON error as a connect miss', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ error: { code: -1, message: 'no wallet' } }),
    });
    await expect(rpcCall(auth, 'getblocktemplate', [{}], { fetchFn })).rejects.toThrow(/no wallet/);
  });
});
