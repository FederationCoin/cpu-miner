import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canStopNode, nodeArgv, nodeCommand, nodePortLines, spawnNode } from './node-process.js';

describe('node-process', () => {
  it('builds loopback testnet argv and refuses dummy MAIN', () => {
    expect(nodeArgv('testnet', '/tmp/fc', 35332)).toEqual([
      '-testnet',
      '-datadir=/tmp/fc',
      '-bind=127.0.0.1',
      '-server=1',
      '-rpcbind=127.0.0.1',
      '-rpcallowip=127.0.0.1',
      '-rpcport=35332',
      '-natpmp=0',
      '-upnp=0',
    ]);
    expect(nodeArgv('testnet', '/tmp/fc', 35332, true, 'computer', false)).toEqual([
      '-testnet',
      '-datadir=/tmp/fc',
      '-bind=127.0.0.1',
      '-natpmp=0',
      '-upnp=0',
    ]);
    expect(nodeArgv('testnet', '/tmp/fc', 35332, true, 'network')).toEqual([
      '-testnet',
      '-datadir=/tmp/fc',
      '-bind=0.0.0.0',
      '-server=1',
      '-rpcbind=0.0.0.0',
      '-rpcallowip=127.0.0.1',
      '-rpcallowip=10.0.0.0/8',
      '-rpcallowip=172.16.0.0/12',
      '-rpcallowip=192.168.0.0/16',
      '-rpcport=35332',
      '-natpmp=0',
      '-upnp=0',
    ]);
    expect(() => nodeArgv('main', '/tmp/fc', 4094)).toThrow(/MAIN is not live/);
    expect(nodeCommand('federationcoind', 'testnet', '/tmp/fc')).toContain('-testnet');
    expect(nodePortLines('testnet').map((p) => p.port)).toEqual([35332, 35333]);
    expect(() => nodeCommand('federationcoind', 'main', '/tmp/fc')).toThrow(/MAIN is not live/);
    expect(nodeArgv('main', '/tmp/fc', 4094, true)).toEqual([
      '-datadir=/tmp/fc',
      '-bind=127.0.0.1',
      '-server=1',
      '-rpcbind=127.0.0.1',
      '-rpcallowip=127.0.0.1',
      '-rpcport=4094',
      '-natpmp=0',
      '-upnp=0',
    ]);
  });

  it('Stop is only for spawned sessions', () => {
    const child = { kill() {} } as unknown as ChildProcess;
    expect(canStopNode({ kind: 'idle' })).toBe(false);
    expect(canStopNode({ kind: 'attached', chain: 'testnet' })).toBe(false);
    expect(canStopNode({ kind: 'spawned', child, chain: 'testnet' })).toBe(true);
    expect(() => spawnNode({ kind: 'missing' }, 'testnet')).toThrow(/addon/);
    const proc = spawnNode({ kind: 'present', path: process.execPath }, 'testnet', mkdtempSync(join(tmpdir(), 'fc-node-')));
    expect(proc.pid).toBeTruthy();
    proc.kill();
  });
});
