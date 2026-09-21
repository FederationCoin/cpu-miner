import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canStopNode, nodeArgv, spawnNode } from './node-process.js';

describe('node-process', () => {
  it('builds loopback testnet argv and refuses dummy MAIN', () => {
    expect(nodeArgv('testnet', '/tmp/fc', 35332)).toEqual([
      '-testnet',
      '-datadir=/tmp/fc',
      '-server=1',
      '-bind=127.0.0.1',
      '-rpcbind=127.0.0.1',
      '-rpcallowip=127.0.0.1',
      '-rpcport=35332',
    ]);
    expect(() => nodeArgv('main', '/tmp/fc', 4094)).toThrow(/MAIN is not live/);
    expect(nodeArgv('main', '/tmp/fc', 4094, true)).toEqual([
      '-datadir=/tmp/fc',
      '-server=1',
      '-bind=127.0.0.1',
      '-rpcbind=127.0.0.1',
      '-rpcallowip=127.0.0.1',
      '-rpcport=4094',
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
