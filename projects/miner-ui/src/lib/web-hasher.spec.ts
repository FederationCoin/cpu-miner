import { describe, expect, it } from 'vitest';
import { DEFAULT_HOSTED_TESTNET } from './miner-shell';
import { WebHasherHost } from './web-hasher';
import type { StratumWsClock } from './stratum-ws';

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(ev: { data?: string }) => void>>();
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (ev: { data?: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    for (const fn of this.listeners.get('close') ?? []) {
      fn({});
    }
  }
  openNow(): void {
    this.readyState = 1;
    for (const fn of this.listeners.get('open') ?? []) {
      fn({});
    }
  }
  pushLine(obj: unknown): void {
    for (const fn of this.listeners.get('message') ?? []) {
      fn({ data: `${JSON.stringify(obj)}\n` });
    }
  }
}

type Timer = { fn: () => void; ms: number };

function testClock(): StratumWsClock & { timers: Map<number, Timer>; runAll: () => void } {
  const timers = new Map<number, Timer>();
  let next = 1;
  return {
    timers,
    now: () => 0,
    schedule: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    cancel: (id) => {
      timers.delete(id);
    },
    runAll: () => {
      for (const [id, t] of [...timers.entries()]) {
        timers.delete(id);
        t.fn();
      }
    },
  };
}

describe('WebHasherHost reconnect', () => {
  it('reconnects the Stratum socket while mining and stops for real', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ running: true, chain: 'testnet', status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const sockets: FakeWebSocket[] = [];
    const clock = testClock();
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET, {
      open: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
      clock,
      backoffFirstMs: 5,
      backoffMaxMs: 5,
    });
    try {
      const stats: string[] = [];
      host.onStats((s) => stats.push(s.status));
      const r = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: { kind: 'hostedPoolStratum', worker: 'tgfcn1abc.cpu', password: 'x' },
      });
      expect(r.ok).toBe(true);
      sockets[0]!.openNow();
      sockets[0]!.pushLine({ id: 1, error: null, result: [[], 'aabbccdd', 8] });
      sockets[0]!.pushLine({ id: 2, error: null, result: true });
      expect(stats.some((s) => s.includes('authorized'))).toBe(true);
      sockets[0]!.close();
      expect(stats.some((s) => s.includes('reconnecting'))).toBe(true);
      clock.runAll();
      expect(sockets).toHaveLength(2);
      await host.stop();
      const n = sockets.length;
      clock.runAll();
      expect(sockets.length).toBe(n);
    } finally {
      globalThis.fetch = origFetch;
      const timer = (host as unknown as { pollTimer: ReturnType<typeof setInterval> | null }).pollTimer;
      if (timer) {
        clearInterval(timer);
      }
    }
  });
});
