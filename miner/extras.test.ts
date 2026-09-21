import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extraChecksumOk,
  probeExtras,
  resolveAddon,
  resolveGatewayBin,
  resolveNodeBin,
  sha256File,
} from './extras.js';

describe('extras', () => {
  it('resolves env, packaged, vendor, sibling, then missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-extras-'));
    const bin = join(dir, 'federationcoind');
    writeFileSync(bin, 'x');
    expect(resolveAddon('FEDERATIONCOIND_BIN', 'federationcoind', 'federationcoind', { FEDERATIONCOIND_BIN: bin }, dir, dir, 'linux')).toEqual({
      kind: 'present',
      path: bin,
    });
    const packagedDir = mkdtempSync(join(tmpdir(), 'fc-pack-'));
    mkdirSync(join(packagedDir, 'federationcoind'));
    const packaged = join(packagedDir, 'federationcoind', 'federationcoind');
    writeFileSync(packaged, 'p');
    expect(resolveNodeBin({}, dir, packagedDir, 'linux').kind).toBe('present');
    expect(resolveAddon('NOPE', 'missing-addon', 'missing-addon', {}, dir, dir, 'linux')).toEqual({ kind: 'missing' });
    expect(resolveGatewayBin({}, dir, dir, 'win32').kind).toBe('missing');
    const vendorRoot = mkdtempSync(join(tmpdir(), 'fc-vendor-'));
    const here = join(vendorRoot, 'miner');
    mkdirSync(here);
    mkdirSync(join(vendorRoot, 'vendor', 'federationcoind'), { recursive: true });
    writeFileSync(join(vendorRoot, 'vendor', 'federationcoind', 'federationcoind'), 'vendor');
    expect(resolveNodeBin({}, here, join(vendorRoot, 'no-resources'), 'linux').kind).toBe('present');
    const sibRoot = mkdtempSync(join(tmpdir(), 'fc-sib-'));
    const sibHere = join(sibRoot, 'cpu-miner', 'miner');
    mkdirSync(sibHere, { recursive: true });
    mkdirSync(join(sibRoot, 'federationcoind'));
    writeFileSync(join(sibRoot, 'federationcoind', 'federationcoind'), 'sib');
    expect(resolveNodeBin({}, sibHere, join(sibRoot, 'missing'), 'linux').kind).toBe('present');
    const winPack = mkdtempSync(join(tmpdir(), 'fc-win-'));
    mkdirSync(join(winPack, 'federationcoind'));
    writeFileSync(join(winPack, 'federationcoind', 'federationcoind.exe'), 'w');
    expect(resolveNodeBin({}, dir, winPack, 'win32').kind).toBe('present');
  });

  it('probe booleans omit filesystem paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-probe-'));
    const probe = probeExtras({}, dir, dir, 'linux', () => null);
    expect(probe).toEqual({ node: false, gateway: false, pool: false });
    expect(JSON.stringify(probe)).not.toMatch(/\//);
  });

  it('checksums match a pin and reject empty or missing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-sum-'));
    const path = join(dir, 'bin');
    writeFileSync(path, 'hello');
    const sum = sha256File(path);
    expect(extraChecksumOk(path, sum)).toBe(true);
    expect(extraChecksumOk(path, 'ab'.repeat(32))).toBe(false);
    expect(extraChecksumOk(path, '')).toBe(false);
    expect(extraChecksumOk(join(dir, 'nope'), sum)).toBe(false);
  });
});
