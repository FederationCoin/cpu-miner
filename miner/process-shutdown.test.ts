import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { finishChildren } from './process-ipc.js';

function fakeChild(pid: number, exited = false): ChildProcess & { signals: string[] } {
  const signals: string[] = [];
  return {
    pid,
    exitCode: exited ? 0 : null,
    signalCode: null,
    signals,
    kill(signal: NodeJS.Signals) {
      signals.push(signal);
      return true;
    },
  } as ChildProcess & { signals: string[] };
}

describe('finishChildren', () => {
  it('SIGTERMs and waits until the child exits', async () => {
    const child = fakeChild(9);
    let checks = 0;
    await finishChildren([child], 1000, () => {
      checks += 1;
      return checks < 2;
    });
    expect(child.signals).toEqual(['SIGTERM']);
    expect(checks).toBeGreaterThan(1);
  });

  it('leaves a child that has already exited', async () => {
    const child = fakeChild(9, true);
    await finishChildren([child], 1000, () => true);
    expect(child.signals).toEqual([]);
  });

  it('abandons a child that is still alive when the wait ends', async () => {
    const child = fakeChild(4);
    await finishChildren([child], 0, () => true);
    expect(child.signals).toEqual(['SIGTERM']);
  });
});
