import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cpuPercent,
  firstForeignListener,
  formatCommand,
  formatRss,
  gatewayPorts,
  listenHolder,
  nodeDebugLogPath,
  nodePorts,
  otherProcessCount,
  peersFromRpc,
  pidForSocketInodes,
  pidsFromLines,
  pidsWithCommIn,
  preExistingProcessMessage,
  pushRing,
  readLogTail,
  readUsage,
  rssFromStatm,
  tailLines,
  tcpListenInodes,
  ticksFromStat,
  trafficFromRpc,
  txNote,
  txsFromRpc,
  usageFromSamples,
  usageFromWindowsLine,
} from './process-usage.js';

const TCP = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0100007F:8A05 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 42 1 00000000 100 0 0 10 0',
  '   1: 0100007F:0050 00000000:0000 01 00000000:00000000 00:00000000 00000000  1000        0 7 1 00000000 100 0 0 10 0',
  '   2: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 0 1 00000000 100 0 0 10 0',
].join('\n');

describe('tcp listeners', () => {
  it('reads a listen inode and ignores established rows and inode 0', () => {
    expect(tcpListenInodes(TCP, 35333)).toEqual(['42']);
    expect(tcpListenInodes(TCP, 80)).toEqual([]);
    expect(tcpListenInodes(TCP, 8080)).toEqual([]);
    expect(tcpListenInodes('short', 1)).toEqual([]);
  });

  it('names the process that owns the socket', () => {
    expect(pidForSocketInodes('/missing', [])).toBeNull();
    expect(pidForSocketInodes('/missing', ['42'])).toBeNull();
    const root = mkdtempSync(join(tmpdir(), 'fc-proc-'));
    mkdirSync(join(root, '99', 'fd'), { recursive: true });
    writeFileSync(join(root, '99', 'fd', '3'), '');
    writeFileSync(join(root, '99', 'fd', '4'), '');
    const pid = pidForSocketInodes(root, ['42'], (path) => {
      if (path.endsWith('/3')) {
        throw new Error('unread');
      }
      return 'socket:[42]';
    });
    expect(pid).toBe(99);
    symlinkSync('socket:[42]', join(root, '99', 'fd', '8'));
    expect(pidForSocketInodes(root, ['42'])).toBe(99);
    mkdirSync(join(root, 'net'), { recursive: true });
    writeFileSync(join(root, 'net', 'tcp'), TCP);
    const holder = listenHolder(
      35333,
      root,
      (path) => {
        if (path.endsWith('tcp6')) {
          throw new Error('no tcp6');
        }
        return TCP;
      },
      () => 'socket:[42]',
    );
    expect(holder).toEqual({ port: 35333, pid: 99 });
    expect(listenHolder(1, root, () => { throw new Error('missing'); })).toBeNull();
  });

  it('skips the listener this mill spawned', () => {
    expect(preExistingProcessMessage('gateway')).toMatch(/pre-existing gateway process/);
    expect(preExistingProcessMessage('gateway')).toMatch(/new gateway process/);
    expect(
      firstForeignListener([23334], 10, (port) => ({ port, pid: 10 })),
    ).toBeNull();
    expect(
      firstForeignListener([23334, 23335], null, (port) => (port === 23335 ? { port, pid: 4 } : null)),
    ).toEqual({ port: 23335, pid: 4 });
    expect(firstForeignListener([1], null, () => null)).toBeNull();
    expect(firstForeignListener([1])).toBeNull();
  });

  it('covers command, log, proc, and rpc helpers', () => {
    expect(formatCommand('  ', [])).toBe('');
    expect(formatCommand('/bin/x', ['-a'])).toBe('/bin/x -a');
    expect(nodePorts('main').map((p) => p.port)).toEqual([4094]);
    expect(gatewayPorts().map((p) => p.port)).toEqual([23334, 23335]);
    expect(nodeDebugLogPath('/tmp/fc', 'testnet')).toBe('/tmp/fc/testnet3/debug.log');
    expect(nodeDebugLogPath('/tmp/fc/testnet3', 'main')).toBe('/tmp/fc/testnet3/debug.log');
    expect(tailLines('a\nb\nc', 2)).toBe('b\nc');
    expect(readLogTail('/no/such/debug.log', 'secret')).toBe('');
    const log = mkdtempSync(join(tmpdir(), 'fc-log-'));
    writeFileSync(join(log, 'debug.log'), 'hello secret\n');
    expect(readLogTail(join(log, 'debug.log'), 'secret')).toBe('hello ***');
    expect(pushRing(['a'], ' b \n\n c ', 2)).toEqual(['b', 'c']);
    expect(ticksFromStat('no-paren')).toBeNull();
    expect(ticksFromStat('1 (name) S 1')).toBeNull();
    expect(ticksFromStat(`1 (name) S ${'0 '.repeat(10)}10 5`)).toBe(15);
    expect(formatRss(Number.NaN)).toBe('');
    expect(formatRss(1024 * 1024)).toBe('1.0 MiB');
    expect(rssFromStatm('1 nope')).toBe('');
    expect(rssFromStatm('1 1')).toBe('0.0 MiB');
    expect(cpuPercent(1, 10)).toBe('');
    expect(cpuPercent(1_000_000, 200)).toBe('');
    expect(cpuPercent(10, 1000)).toBe('10.0%');
    const stat = `1 (name) S ${'0 '.repeat(10)}10 5`;
    expect(usageFromSamples('bad', '1 1', undefined, 1000)).toBeNull();
    expect(usageFromSamples(stat, '1 2', { ticks: 5, at: 0 }, 1000).cpu).toBe('10.0%');
    expect(usageFromWindowsLine(1, 1024 * 1024, undefined, 1000).rss).toBe('1.0 MiB');
    expect(usageFromWindowsLine(2, -1, { cpu: 1, at: 0 }, 1000).cpu).toBe('100.0%');
    expect(usageFromWindowsLine(Number.NaN, 0, { cpu: 0, at: 0 }, 1000).sample.cpu).toBe(0);
    expect(readUsage(1, undefined, 1, () => { throw new Error('missing'); })).toEqual({ cpu: '', rss: '' });
    expect(readUsage(1, undefined, 1, () => 'bad').cpu).toBe('');
    const proc = mkdtempSync(join(tmpdir(), 'fc-comm-'));
    mkdirSync(join(proc, '7'));
    writeFileSync(join(proc, '7', 'comm'), 'federationcoind\n');
    writeFileSync(join(proc, 'note'), 'x');
    expect(pidsWithCommIn(proc, 'federationcoind')).toEqual([7]);
    expect(pidsWithCommIn('/missing-proc', 'x')).toEqual([]);
    expect(pidsFromLines('1\nno\n2\n')).toEqual([1, 2]);
    expect(otherProcessCount([1, 2], 1)).toBe(1);
    const peers = Array.from({ length: 13 }, (_, i) => ({ addr: i === 0 ? '' : `a${i}`, bytessent: 1, bytesrecv: 2 }));
    peers.push(null);
    expect(peersFromRpc(peers)).toHaveLength(12);
    expect(peersFromRpc(null)).toEqual([]);
    expect(trafficFromRpc(null)).toEqual({ inn: '', out: '' });
    expect(trafficFromRpc({ totalbytesrecv: 3, totalbytessent: null })).toEqual({ inn: '3', out: '' });
    expect(txsFromRpc([{ txid: 'abcdef', amount: 1, category: 'send' }, {}, { category: '' }])).toEqual([
      { txid: 'abcdef', amount: '1', category: 'send' },
    ]);
    expect(txsFromRpc('no')).toEqual([]);
    expect(txNote(true)).toMatch(/wallet/);
    expect(txNote(false)).toMatch(/off/);
  });
});
