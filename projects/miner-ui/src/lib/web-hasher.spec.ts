import { describe, expect, it } from 'vitest';
import { DEFAULT_HOSTED_TESTNET } from './miner-shell';
import { GRIND_GRACE_MS, WebHasherHost } from './web-hasher';
import { StratumWsClient, type StratumWsClock } from './stratum-ws';

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(ev: { data?: unknown }) => void>>();
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (ev: { data?: unknown }) => void): void {
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

type Timer = { fn: () => void; ms: number; due: number };

function testClock(): StratumWsClock & {
  timers: Map<number, Timer>;
  runAll: () => void;
  advance: (ms: number) => void;
} {
  const timers = new Map<number, Timer>();
  let next = 1;
  let now = 0;
  const fireDue = (): void => {
    for (const [id, t] of [...timers.entries()]) {
      if (t.due <= now) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  return {
    timers,
    now: () => now,
    schedule: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, ms, due: now + ms });
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
    advance: (ms) => {
      now += ms;
      fireDue();
    },
  };
}

function handshake(ws: FakeWebSocket, extraNonce1 = 'aabbccdd'): void {
  ws.pushLine({ id: 1, error: null, result: [[], extraNonce1, 8] });
  ws.pushLine({ id: 2, error: null, result: true });
}

function notify(ws: FakeWebSocket, jobId = 'job1'): void {
  ws.pushLine({
    method: 'mining.notify',
    params: [jobId, '11'.repeat(32), '22'.repeat(39), '', [], '1e00ffff', '1e00ffff', '01020304'],
  });
}

function mineSocket(sockets: FakeWebSocket[]): FakeWebSocket {
  return sockets[sockets.length - 1]!;
}

describe('WebHasherHost reconnect', () => {
  it('reconnects the Stratum socket while mining and stops for real', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('HTTP /api/stats must not be polled');
    }) as typeof fetch;
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
      const errors: string[] = [];
      host.onStats((s) => {
        stats.push(s.status);
        errors.push(s.lastError);
      });
      const r = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: { kind: 'stratumPoolWebsocket', url: 'wss://pool.testnet.federationcoin.org/stratum', worker: 'tgfcn1abc.cpu' },
      });
      expect(r.ok).toBe(true);
      const mine = mineSocket(sockets);
      mine.openNow();
      handshake(mine);
      expect(stats.some((s) => s.includes('authorized'))).toBe(true);
      mine.close();
      expect(stats.some((s) => s.includes('reconnecting'))).toBe(true);
      expect(errors.at(-1)).toBe('');
      clock.runAll();
      expect(sockets.length).toBeGreaterThan(1);
      await host.stop();
      const n = sockets.length;
      clock.runAll();
      expect(sockets.length).toBe(n);
    } finally {
      globalThis.fetch = origFetch;
      host.stopWatch();
    }
  });

  it('toasts when mining.notify coinb1 is not 39 bytes', async () => {
    const sockets: FakeWebSocket[] = [];
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET, {
      open: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
    });
    try {
      const toasts: string[] = [];
      host.onToast((m) => toasts.push(m.message));
      const r = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: { kind: 'stratumPoolWebsocket', url: 'wss://pool.testnet.federationcoin.org/stratum', worker: 'tgfcn1abc.cpu' },
      });
      expect(r.ok).toBe(true);
      const mine = mineSocket(sockets);
      mine.openNow();
      handshake(mine);
      mine.pushLine({
        method: 'mining.notify',
        params: ['j', '11'.repeat(32), '22'.repeat(38), '', [], '20000000', '1e00ffff', '01020304', true],
      });
      expect(toasts).toContain('bad mining.notify (coinb1 38 bytes)');
      await host.stop();
    } finally {
      host.stopWatch();
    }
  });

  it('starts stratumPoolWebsocket at wss://host/stratum', async () => {
    const sockets: FakeWebSocket[] = [];
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET, {
      open: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
    });
    try {
      const r = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: {
          kind: 'stratumPoolWebsocket',
          url: 'wss://pool.testnet.federationcoin.org/stratum',
          worker: 'tgfcn1abc.cpu',
        },
      });
      expect(r.ok).toBe(true);
      expect(sockets[0]!.url).toBe('wss://pool.testnet.federationcoin.org/stratum');
      await host.stop();
    } finally {
      host.stopWatch();
    }
  });

  it('starts pool and gateway WebSocket URLs and refuses TCP Stratum', async () => {
    const sockets: FakeWebSocket[] = [];
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET, {
      open: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
    });
    try {
      const tcp = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: {
          kind: 'stratum',
          stratum: {
            host: 'stratum.testnet.federationcoin.org',
            port: 23334,
            worker: 'tgfcn1abc.cpu',
            password: 'x',
          },
        },
      });
      expect(tcp.ok).toBe(false);
      expect(tcp.error).toMatch(/TCP Stratum/);
      const gw = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: {
          kind: 'datumGatewayWebsocket',
          url: 'ws://127.0.0.1:23335/stratum',
          worker: 'tgfcn1abc.cpu',
        },
      });
      expect(gw.ok).toBe(true);
      expect(sockets.at(-1)!.url).toBe('ws://127.0.0.1:23335/stratum');
      expect((host as unknown as { pollTimer?: unknown }).pollTimer).toBeUndefined();
    } finally {
      host.stopWatch();
    }
  });

  it('refuses an empty pool WebSocket URL', async () => {
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET);
    try {
      const r = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: { kind: 'stratumPoolWebsocket', url: '  ', worker: 'tgfcn1abc.cpu' },
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/WebSocket Stratum/);
    } finally {
      host.stopWatch();
    }
  });

  it('applies pool_stats only while mining stratumPoolWebsocket', async () => {
    const sockets: FakeWebSocket[] = [];
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET, {
      open: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
    });
    const poolSnap: number[] = [];
    host.onPoolStats((s) => poolSnap.push(s.height));
    const stats = {
      method: 'client.pool_stats',
      params: [{ running: true, chain: 'testnet', height: 42, status: 'hosted' }],
    };
    try {
      await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: { kind: 'datumGatewayWebsocket', url: 'ws://127.0.0.1:23335/stratum', worker: 'tgfcn1abc.cpu' },
      });
      const gw = sockets.at(-1)!;
      gw.openNow();
      gw.pushLine(stats);
      expect(poolSnap.at(-1)).toBe(0);
      await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: {
          kind: 'stratumPoolWebsocket',
          url: 'wss://pool.testnet.federationcoin.org/stratum',
          worker: 'tgfcn1abc.cpu',
        },
      });
      const pool = sockets.at(-1)!;
      pool.openNow();
      pool.pushLine(stats);
      expect(poolSnap.at(-1)).toBe(42);
    } finally {
      host.stopWatch();
    }
  });

  it('sends client.gateway_info on gateway start and still mines if the extra errors', async () => {
    const sockets: FakeWebSocket[] = [];
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET, {
      open: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
    });
    const infos: string[] = [];
    host.onGatewayInfo((info) => infos.push(info.kind));
    try {
      const r = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: { kind: 'datumGatewayWebsocket', url: 'ws://127.0.0.1:23335/stratum', worker: 'tgfcn1abc.cpu' },
      });
      expect(r.ok).toBe(true);
      const mine = mineSocket(sockets);
      mine.openNow();
      expect(mine.sent.some((l) => l.includes('client.gateway_info'))).toBe(true);
      handshake(mine);
      mine.pushLine({ id: 9, error: [24, 'gateway info disabled', null], result: null });
      expect(infos).toEqual(['notProvided']);
      notify(mine);
      await Promise.resolve();
      expect(host.miningSocketOpen()).toBe(true);
      const n = sockets.length;
      expect(host.requestGatewayInfo()).toBe(true);
      expect(sockets.length).toBe(n);
      await host.stop();
    } finally {
      host.stopWatch();
    }
  });

  it('does not open a second socket for gateway info while mining the gateway', async () => {
    const sockets: FakeWebSocket[] = [];
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET, {
      open: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
    });
    try {
      await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: { kind: 'datumGatewayWebsocket', url: 'ws://127.0.0.1:23335/stratum', worker: 'tgfcn1abc.cpu' },
      });
      const mine = mineSocket(sockets);
      mine.openNow();
      handshake(mine);
      const n = sockets.length;
      expect(host.miningSocketOpen()).toBe(true);
      host.requestGatewayInfo();
      expect(sockets.length).toBe(n);
    } finally {
      host.stopWatch();
    }
  });

  it('pauses grind after the grace window while the outbox still retries', async () => {
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
      submitRetryMs: 50,
    });
    try {
      const snap: Array<{ hashes: number; hashrate: number; lastError: string; link: string }> = [];
      host.onStats((s) => snap.push({ hashes: s.hashes, hashrate: s.hashrate, lastError: s.lastError, link: s.link }));
      const toasts: string[] = [];
      host.onToast((m) => toasts.push(m.message));
      const r = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: { kind: 'stratumPoolWebsocket', url: 'wss://pool.testnet.federationcoin.org/stratum', worker: 'tgfcn1abc.cpu' },
      });
      expect(r.ok).toBe(true);
      const mine = mineSocket(sockets);
      mine.openNow();
      handshake(mine);
      notify(mine);
      await Promise.resolve();
      clock.advance(0);
      await Promise.resolve();
      const hashesBefore = snap.at(-1)?.hashes ?? 0;
      expect(hashesBefore).toBeGreaterThan(0);
      const client = (host as unknown as { client: StratumWsClient | null }).client;
      expect(client).toBeTruthy();
      client!.submit('job1', new Uint8Array(8), new Uint8Array(8), new Uint8Array(8));
      mine.close();
      expect(toasts).toContain('connection closed');
      expect(snap.at(-1)?.lastError).toBe('');
      expect(snap.at(-1)?.link).toBe('down');
      await Promise.resolve();
      clock.advance(0);
      const hashesMid = snap.at(-1)?.hashes ?? 0;
      expect(hashesMid).toBeGreaterThanOrEqual(hashesBefore);
      clock.advance(GRIND_GRACE_MS);
      const hashesPaused = snap.at(-1)?.hashes ?? 0;
      clock.advance(0);
      clock.advance(0);
      expect(snap.at(-1)?.hashes).toBe(hashesPaused);
      expect(snap.at(-1)?.hashrate).toBe(0);
      clock.advance(5);
      const resumed = mineSocket(sockets);
      expect(resumed).not.toBe(mine);
      resumed.openNow();
      handshake(resumed);
      expect(resumed.sent.filter((l) => l.includes('mining.submit')).length).toBeGreaterThan(0);
      await host.stop();
    } finally {
      host.stopWatch();
    }
  });

  it('does not poll HTTP /api/stats and applies pushed pool height', async () => {
    let fetches = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const sockets: FakeWebSocket[] = [];
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET, {
      open: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
    });
    try {
      const heights: number[] = [];
      host.onStats((s) => heights.push(s.height));
      const r = await host.start({
        chain: 'testnet',
        threads: 1,
        mineTo: { kind: 'stratumPoolWebsocket', url: 'wss://pool.testnet.federationcoin.org/stratum', worker: 'tgfcn1abc.cpu' },
      });
      expect(r.ok).toBe(true);
      const mine = mineSocket(sockets);
      mine.openNow();
      handshake(mine);
      mine.pushLine({
        method: 'client.pool_stats',
        params: [{ running: true, chain: 'testnet', height: 2, workers: 1, accepted: 0, rejected: 0 }],
      });
      expect(heights.at(-1)).toBe(2);
      expect(fetches).toBe(0);
      await host.stop();
    } finally {
      globalThis.fetch = origFetch;
      host.stopWatch();
    }
  });

  it('refuses dummy MAIN', async () => {
    const host = new WebHasherHost(DEFAULT_HOSTED_TESTNET);
    const r = await host.start({
      chain: 'main',
      threads: 1,
      mineTo: { kind: 'stratumPoolWebsocket', url: 'wss://pool.example/stratum', worker: 'gfcn1abc' },
    });
    expect(r).toEqual({ ok: false, error: 'MAIN is not live' });
  });
});
