import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extraChecksumOk,
  extraFetchReady,
  extraPinSha,
  millArtifact,
  parseExtrasManifest,
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

  it('parses extras pins, maps mill OS, and skips empty fetch', () => {
    expect(parseExtrasManifest(null)).toBeNull();
    expect(parseExtrasManifest({})).toBeNull();
    expect(millArtifact('win32', 'x64')).toBe('win-x64');
    expect(millArtifact('darwin', 'arm64')).toBe('macos-arm64');
    expect(millArtifact('darwin', 'x64')).toBe('macos-x64');
    expect(millArtifact('linux', 'arm64')).toBe('linux-arm64');
    expect(millArtifact('linux', 'x64')).toBe('linux-x64');
    const assets = {
      'linux-x64': { name: 'federationcoind-linux-x64.zip', sha256: '' },
      'linux-arm64': { name: 'federationcoind-linux-arm64.zip', sha256: '' },
      'win-x64': { name: 'federationcoind-win-x64.zip', sha256: '' },
      'macos-arm64': { name: 'federationcoind-macos-arm64.zip', sha256: '' },
      'macos-x64': { name: 'federationcoind-macos-x64.zip', sha256: '' },
    };
    const gwAssets = {
      'linux-x64': { name: 'datum_gateway-linux-x64.zip', sha256: '' },
      'linux-arm64': { name: 'datum_gateway-linux-arm64.zip', sha256: '' },
      'win-x64': { name: 'datum_gateway-win-x64.zip', sha256: '' },
      'macos-arm64': { name: 'datum_gateway-macos-arm64.zip', sha256: '' },
      'macos-x64': { name: 'datum_gateway-macos-x64.zip', sha256: '' },
    };
    expect(parseExtrasManifest({ node: { gitSha: 'a', tag: '', repo: 'evil/x', assets }, gateway: { gitSha: 'b', tag: '', repo: 'FederationCoin/datum_gateway', assets: gwAssets } })).toBeNull();
    const ok = parseExtrasManifest({
      node: { gitSha: '0be59f36422c1fdf01dee1530af45172d64731c1', tag: '', repo: 'FederationCoin/FederationCoin', assets },
      gateway: { gitSha: '47f890aa38a7241e8d68ac385b2aa4577ae61452', tag: '', repo: 'FederationCoin/datum_gateway', assets: gwAssets },
    });
    expect(ok?.node.gitSha.startsWith('0be59f36')).toBe(true);
    expect(extraFetchReady(ok!.node, 'linux-x64')).toBe(false);
    expect(extraPinSha(ok!.node, 'linux-x64')).toBe('');
    const filled = {
      ...ok!.node,
      tag: 'v29.5.0.federationcoin20260920.rc1',
      assets: {
        ...ok!.node.assets,
        'linux-x64': { name: 'federationcoind-linux-x64.zip', sha256: 'ab'.repeat(32) },
      },
    };
    expect(extraFetchReady(filled, 'linux-x64')).toBe(true);
    expect(extraFetchReady(filled, 'win-x64')).toBe(false);
    expect(extraFetchReady({ ...filled, tag: '  ' }, 'linux-x64')).toBe(false);
    expect(extraPinSha(undefined, 'linux-x64')).toBe('');
    expect(parseExtrasManifest({ node: { gitSha: 1, tag: '', repo: 'FederationCoin/FederationCoin', assets }, gateway: ok!.gateway })).toBeNull();
    expect(
      parseExtrasManifest({
        node: { gitSha: 'a', tag: '', repo: 'FederationCoin/FederationCoin', assets: {} },
        gateway: ok!.gateway,
      }),
    ).toBeNull();
    expect(
      parseExtrasManifest({
        node: ok!.node,
        gateway: { ...ok!.gateway, repo: 'CONVOYMining/datum_gateway' },
      }),
    ).toBeNull();
    expect(extraFetchReady({ ...filled, gitSha: '' }, 'linux-x64')).toBe(false);
    expect(extraFetchReady({ ...filled, tag: 'x', assets: { ...filled.assets, 'linux-x64': { name: 'n', sha256: 'dead' } } }, 'linux-x64')).toBe(false);
    expect(extraFetchReady({ ...filled, assets: { ...filled.assets, 'linux-x64': { name: '', sha256: 'ab'.repeat(32) } } }, 'linux-x64')).toBe(false);
    expect(extraPinSha(filled, 'linux-x64')).toBe('ab'.repeat(32));
    expect(millArtifact()).toMatch(/^(linux-x64|linux-arm64|win-x64|macos-arm64|macos-x64)$/);
    expect(millArtifact('freebsd', 'x64')).toBe('linux-x64');
    expect(parseExtrasManifest(1)).toBeNull();
    expect(parseExtrasManifest({ node: 'x', gateway: ok!.gateway })).toBeNull();
    expect(parseExtrasManifest({ node: { gitSha: 'a', tag: 1, repo: 'FederationCoin/FederationCoin', assets }, gateway: ok!.gateway })).toBeNull();
    expect(parseExtrasManifest({ node: { gitSha: 'a', tag: '', repo: 1, assets }, gateway: ok!.gateway })).toBeNull();
    expect(parseExtrasManifest({ node: { gitSha: 'a', tag: '', repo: 'FederationCoin/FederationCoin', assets: null }, gateway: ok!.gateway })).toBeNull();
    expect(parseExtrasManifest({ node: { gitSha: 'a', tag: '', repo: 'FederationCoin/FederationCoin', assets: 1 }, gateway: ok!.gateway })).toBeNull();
    expect(
      parseExtrasManifest({
        node: { gitSha: 'a', tag: '', repo: 'FederationCoin/FederationCoin', assets: { ...assets, 'linux-x64': 'x' } },
        gateway: ok!.gateway,
      }),
    ).toBeNull();
    expect(
      parseExtrasManifest({
        node: { gitSha: 'a', tag: '', repo: 'FederationCoin/FederationCoin', assets: { ...assets, 'linux-x64': { name: 1, sha256: '' } } },
        gateway: ok!.gateway,
      }),
    ).toBeNull();
    expect(
      parseExtrasManifest({
        node: { gitSha: 'a', tag: '', repo: 'FederationCoin/FederationCoin', assets: { ...assets, 'linux-x64': { name: 'x', sha256: 1 } } },
        gateway: ok!.gateway,
      }),
    ).toBeNull();
    expect(
      parseExtrasManifest({
        node: { ...ok!.node, repo: 'FederationCoin/datum_gateway' },
        gateway: ok!.gateway,
      }),
    ).toBeNull();
    expect(
      parseExtrasManifest({
        node: ok!.node,
        gateway: { ...ok!.gateway, repo: 'FederationCoin/FederationCoin' },
      }),
    ).toBeNull();
    expect(parseExtrasManifest({ node: ok!.node })).toBeNull();
  });

  it('loads extras-checksums.json as an empty-fetch pin', () => {
    const raw = JSON.parse(readFileSync(new URL('../extras-checksums.json', import.meta.url), 'utf8'));
    const parsed = parseExtrasManifest(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.node.repo).toBe('FederationCoin/FederationCoin');
    expect(parsed!.gateway.repo).toBe('FederationCoin/datum_gateway');
    expect(extraFetchReady(parsed!.node, 'linux-x64')).toBe(false);
    expect(extraFetchReady(parsed!.gateway, 'win-x64')).toBe(false);
  });
});
