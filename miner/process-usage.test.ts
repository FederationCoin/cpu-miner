import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cpuPercent,
  formatCommand,
  formatRss,
  gatewayPorts,
  nodeDebugLogPath,
  nodePorts,
  otherProcessCount,
  peersFromRpc,
  pidsFromLines,
  pidsWithCommIn,
  pushRing,
  readLogTail,
  readUsage,
  rssFromStatm,
  tailLines,
  ticksFromStat,
  trafficFromRpc,
  txNote,
  txsFromRpc,
  usageFromSamples,
  usageFromWindowsLine,
} from './process-usage.js';

const STAT = '1 (federationcoind) S 0 0 0 0 0 0 0 0 0 0 100 50 0';

describe('process-usage', () => {
  it('formats a command and leaves an empty binary blank', () => {
    expect(formatCommand(' /bin/federationcoind ', ['-testnet', '-datadir=/tmp'])).toBe(
      '/bin/federationcoind -testnet -datadir=/tmp',
    );
    expect(formatCommand('  ', ['-testnet'])).toBe('');
  });

  it('lists testnet and main ports', () => {
    expect(nodePorts('testnet').map((p) => p.port)).toEqual([35332, 35333]);
    expect(nodePorts('main')).toEqual([{ label: 'RPC', port: 4094 }]);
    expect(gatewayPorts().map((p) => p.port)).toEqual([23334, 23335]);
  });

  it('points debug.log at testnet3 unless the datadir is already that folder', () => {
    expect(nodeDebugLogPath('/home/me/.federationcoin', 'testnet')).toContain('testnet3');
    expect(nodeDebugLogPath('/home/me/.federationcoin/testnet3/', 'testnet')).toMatch(/testnet3\/debug\.log$/);
    expect(nodeDebugLogPath('/home/me/.federationcoin', 'main')).toMatch(/federationcoin\/debug\.log$/);
  });

  it('tails and redacts a log, and returns empty when the file is missing', () => {
    expect(tailLines('a\nb\nc', 2)).toBe('b\nc');
    expect(tailLines('only', 80)).toBe('only');
    const dir = mkdtempSync(join(tmpdir(), 'fc-log-'));
    const path = join(dir, 'debug.log');
    writeFileSync(path, `cookie secretvalue\n${'x\n'.repeat(90)}`);
    const tail = readLogTail(path, 'secretvalue');
    expect(tail).not.toContain('secretvalue');
    expect(tail.split('\n').length).toBeLessThanOrEqual(80);
    expect(readLogTail(join(dir, 'missing.log'), 'secretvalue')).toBe('');
    expect(readLogTail(path, 'ab')).toContain('x');
  });

  it('keeps a stderr ring capped', () => {
    expect(pushRing(['a'], ' b \n\nc ')).toEqual(['a', 'b', 'c']);
    expect(pushRing(['a', 'b'], 'c\nd', 2)).toEqual(['c', 'd']);
  });

  it('reads cpu ticks and rss from proc samples', () => {
    expect(ticksFromStat('nope')).toBeNull();
    expect(ticksFromStat('1 (name) S 0')).toBeNull();
    expect(ticksFromStat(STAT)).toBe(150);
    expect(ticksFromStat('1 (n) S 0 0 0 0 0 0 0 0 0 0 nan 1')).toBeNull();
    expect(readUsage(1, undefined, Date.now()).rss === '' || readUsage(1, undefined, Date.now()).rss.includes('MiB')).toBe(true);
    expect(rssFromStatm('1 nope')).toBe('');
    expect(rssFromStatm('1 -1')).toBe('');
    expect(rssFromStatm('1 2')).toBe(formatRss(8192));
    expect(formatRss(Number.NaN)).toBe('');
    expect(cpuPercent(10, 100)).toBe('');
    expect(cpuPercent(-1, 1000)).toBe('');
    expect(cpuPercent(100000, 200, 1)).toBe('');
    expect(cpuPercent(100, 1000, 100)).toBe('100.0%');
    expect(usageFromSamples('bad', '1 1', undefined, 1000)).toBeNull();
    const first = usageFromSamples(STAT, '1 2', undefined, 1000);
    expect(first?.cpu).toBe('');
    expect(first?.rss).toContain('MiB');
    const second = usageFromSamples(STAT, '1 2', { ticks: 100, at: 0 }, 1000);
    expect(second?.cpu).toBe('50.0%');
    expect(usageFromSamples(STAT, '1 2', { ticks: 150, at: 5000 }, 1000)?.cpu).toBe('');
    expect(usageFromWindowsLine(1, 1024 * 1024, undefined, 1000).cpu).toBe('');
    expect(usageFromWindowsLine(2, 1024 * 1024, { cpu: 1, at: 0 }, 1000).cpu).toBe('100.0%');
    expect(usageFromWindowsLine(Number.NaN, -1, { cpu: 1, at: 0 }, 1000).rss).toBe('');
    expect(usageFromWindowsLine(0, 0, { cpu: 5, at: 0 }, 1000).cpu).toBe('');
  });

  it('returns empty usage when proc cannot be read', () => {
    expect(readUsage(1, undefined, 1, () => { throw new Error('no'); })).toEqual({ cpu: '', rss: '' });
    expect(readUsage(1, undefined, 1, () => 'bad')).toEqual({ cpu: '', rss: '' });
    const ok = readUsage(9, undefined, 5, (path) => (path.endsWith('statm') ? '1 2' : STAT));
    expect(ok.rss).toContain('MiB');
    expect(ok.sample?.ticks).toBe(150);
  });

  it('counts other processes and skips our pid', () => {
    const root = mkdtempSync(join(tmpdir(), 'fc-proc-'));
    mkdirSync(join(root, '4'));
    writeFileSync(join(root, '4', 'comm'), 'federationcoind\n');
    mkdirSync(join(root, '9'));
    writeFileSync(join(root, '9', 'comm'), 'other\n');
    mkdirSync(join(root, 'nope'));
    mkdirSync(join(root, '3'));
    expect(pidsWithCommIn(root, 'federationcoind')).toEqual([4]);
    expect(pidsWithCommIn(join(root, 'missing'), 'federationcoind')).toEqual([]);
    expect(otherProcessCount([4, 8], 4)).toBe(1);
    expect(otherProcessCount([4], null)).toBe(1);
    expect(pidsFromLines('4\n\nx\n8\n')).toEqual([4, 8]);
  });

  it('maps peer, traffic, and transaction RPC rows', () => {
    expect(peersFromRpc(null)).toEqual([]);
    expect(peersFromRpc([null, { addr: '' }, { addr: '1.2.3.4:35333', bytessent: 2, bytesrecv: 3 }])).toEqual([
      { addr: '1.2.3.4:35333', bytesSent: 2, bytesRecv: 3 },
    ]);
    expect(peersFromRpc([{ addr: 'a', bytessent: 'nope' }])).toEqual([{ addr: 'a', bytesSent: 0, bytesRecv: 0 }]);
    const many = Array.from({ length: 20 }, (_, i) => ({ addr: `p${i}` }));
    expect(peersFromRpc(many)).toHaveLength(12);
    expect(trafficFromRpc(null)).toEqual({ inn: '', out: '' });
    expect(trafficFromRpc({ totalbytesrecv: 1 })).toEqual({ inn: '1', out: '' });
    expect(trafficFromRpc({ totalbytesrecv: 1, totalbytessent: 2 })).toEqual({ inn: '1', out: '2' });
    expect(txsFromRpc({})).toEqual([]);
    expect(txsFromRpc([null, {}, { txid: 'a'.repeat(20), amount: 1.5, category: 'send' }])).toEqual([
      { txid: 'a'.repeat(16), amount: '1.5', category: 'send' },
    ]);
    expect(txsFromRpc([{ category: 'receive' }])).toEqual([{ txid: '', amount: '', category: 'receive' }]);
    expect(txsFromRpc(Array.from({ length: 10 }, (_, i) => ({ txid: String(i), category: 'send' })))).toHaveLength(8);
    expect(txNote(true)).toMatch(/node wallet/);
    expect(txNote(false)).toMatch(/off/);
  });
});
