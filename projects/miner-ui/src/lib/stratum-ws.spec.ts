import { describe, expect, it } from 'vitest';
import {
  authorizeLine,
  fetchGatewayInfo,
  isLoopbackWsHost,
  nextWsBackoff,
  parseNotify,
  parseGatewayInfoNotify,
  parseGatewayInfoRpc,
  parsePoolStats,
  parseSetDifficulty,
  parseSubscribeResult,
  gatewayInfoLine,
  peerStatusLabel,
  notifyIgnoreReason,
  shareBodyKey,
  isTcpStratumEndpoint,
  stratumWsUrl,
  submitLine,
  subscribeLine,
  PoolStatsClient,
  StratumWsClient,
  WATCH_STATS_LINE,
  type StratumWsClock,
  type StratumWsHandlers,
} from './stratum-ws';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
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
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  errorNow(): void {
    this.emit('error');
  }

  openNow(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  pushLine(obj: unknown): void {
    this.emit('message', { data: `${JSON.stringify(obj)}\n` });
  }

  pushRaw(data: unknown): void {
    this.emit('message', { data });
  }

  private emit(type: string, ev: { data?: unknown } = {}): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(ev);
    }
  }
}

type Timer = { fn: () => void; ms: number };

function testClock(): StratumWsClock & { timers: Map<number, Timer>; run: (id: number) => void } {
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
    run: (id) => {
      const t = timers.get(id);
      timers.delete(id);
      t?.fn();
    },
  };
}

function silentHandlers(over: Partial<StratumWsHandlers> = {}): StratumWsHandlers {
  return {
    onNotify: () => undefined,
    onDifficulty: () => undefined,
    onSubscribed: () => undefined,
    onAuthorized: () => undefined,
    onSubmitResult: () => undefined,
    onClose: () => undefined,
    onJobIgnored: () => undefined,
    ...over,
  };
}

function handshake(ws: FakeWebSocket, extraNonce1 = 'aabbccdd'): void {
  ws.pushLine({ id: 1, error: null, result: [[], extraNonce1, 8] });
  ws.pushLine({ id: 2, error: null, result: true });
}

describe('stratum-ws', () => {
  it('builds subscribe, authorize, and submit lines', () => {
    expect(JSON.parse(subscribeLine(1))).toEqual({
      id: 1,
      method: 'mining.subscribe',
      params: ['federationcoin-web-miner/0.1'],
    });
    expect(JSON.parse(subscribeLine(1, 'sess-1'))).toEqual({
      id: 1,
      method: 'mining.subscribe',
      params: ['federationcoin-web-miner/0.1', 'sess-1'],
    });
    expect(JSON.parse(authorizeLine(2, 'tgfcn1abc.cpu', 'x'))).toEqual({
      id: 2,
      method: 'mining.authorize',
      params: ['tgfcn1abc.cpu', 'x'],
    });
    const submit = JSON.parse(
      submitLine(10, 'tgfcn1abc.cpu', 'job1', new Uint8Array(8), new Uint8Array(8), new Uint8Array(8)),
    ) as { method: string; params: string[] };
    expect(submit.method).toBe('mining.submit');
    expect(submit.params[0]).toBe('tgfcn1abc.cpu');
    expect(submit.params[1]).toBe('job1');
    expect(submit.params[2]).toBe('0000000000000000');
  });

  it('parses subscribe extraNonce1 and set_difficulty', () => {
    const sub = parseSubscribeResult({ result: [[], 'aabbccdd', 8] });
    expect(sub?.extraNonce1.length).toBe(4);
    expect(sub?.extraNonce2Size).toBe(8);
    expect(parseSetDifficulty({ method: 'mining.set_difficulty', params: [16] })).toBe(16);
    expect(parseSetDifficulty({ method: 'mining.set_difficulty', params: [0] })).toBeNull();
  });

  it('parses DATUM-shaped notify with merkle array and 39-byte coinb1', () => {
    const prev = '11'.repeat(32);
    const coinb1 = '22'.repeat(39);
    const job = parseNotify({
      method: 'mining.notify',
      params: ['abcd', prev, coinb1, '', [], '00000000', '1e00ffff', '01020304'],
    });
    expect(job?.jobId).toBe('abcd');
    expect(job?.prevHidden.length).toBe(32);
    expect(job?.coinb1.length).toBe(39);
    expect(job?.nBits).toBe(0x1e00ffff);
    expect(job?.ntime8[0]).toBe(0x01);
  });

  it('reports 38-byte coinb1 without accepting the job', () => {
    const prev = '11'.repeat(32);
    const coinb1 = '22'.repeat(38);
    const msg = {
      method: 'mining.notify',
      params: ['j', prev, coinb1, '', [], '20000000', '1e00ffff', '01020304', true],
    };
    expect(parseNotify(msg)).toBeNull();
    expect(notifyIgnoreReason(msg)).toBe('bad mining.notify (coinb1 38 bytes)');
  });

  it('maps host/port to a websocket stratum URL', () => {
    expect(stratumWsUrl('127.0.0.1', 23334)).toBe('ws://127.0.0.1:23334/stratum');
    expect(stratumWsUrl('pool.testnet.federationcoin.org', 443)).toBe(
      'wss://pool.testnet.federationcoin.org/stratum',
    );
    expect(stratumWsUrl('wss://example.test/stratum', 1)).toBe('wss://example.test/stratum');
  });

  it('detects TCP NLB Stratum endpoints the browser cannot open', () => {
    expect(isTcpStratumEndpoint('stratum.testnet.federationcoin.org', 23334)).toBe(true);
    expect(isTcpStratumEndpoint('pool.testnet.federationcoin.org', 443)).toBe(false);
    expect(isTcpStratumEndpoint('wss://stratum.testnet.federationcoin.org:23334/stratum', 1)).toBe(true);
  });

  it('keys a share by body, not JSON-RPC id', () => {
    expect(
      shareBodyKey('job1', new Uint8Array(4), new Uint8Array(8), new Uint8Array(8), new Uint8Array(8)),
    ).toContain('job1:');
  });

  it('caps reconnect backoff', () => {
    expect(nextWsBackoff(0)).toBe(1000);
    expect(nextWsBackoff(1000)).toBe(2000);
    expect(nextWsBackoff(40_000)).toBe(60_000);
  });
});

describe('StratumWsClient outbox', () => {
  it('queues shares while the socket is down and flushes after resume', () => {
    const sockets: FakeWebSocket[] = [];
    const clock = testClock();
    const accepted: boolean[] = [];
    const client = new StratumWsClient(
      'ws://pool.test/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers({
        onSubmitResult: (ok) => accepted.push(ok),
      }),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
        clock,
        submitRetryMs: 50,
        backoffFirstMs: 5,
        backoffMaxMs: 5,
      },
    );
    client.connect();
    sockets[0]!.openNow();
    handshake(sockets[0]!);
    sockets[0]!.pushLine({
      method: 'mining.notify',
      params: ['job1', '11'.repeat(32), '22'.repeat(39), '', [], '00000000', '1e00ffff', '01020304'],
    });
    sockets[0]!.close();
    client.submit('job1', new Uint8Array(8), new Uint8Array(8), new Uint8Array(8));
    expect(sockets[0]!.sent.filter((l) => l.includes('mining.submit'))).toHaveLength(0);
    clock.run([...clock.timers.keys()][0]!);
    sockets[1]!.openNow();
    handshake(sockets[1]!);
    const submits = sockets[1]!.sent.filter((l) => l.includes('mining.submit'));
    expect(submits).toHaveLength(1);
    sockets[1]!.pushLine({ id: 10, error: null, result: true });
    expect(accepted).toEqual([true]);
    client.close();
  });

  it('retries two shares independently', () => {
    const sockets: FakeWebSocket[] = [];
    const clock = testClock();
    const results: Array<{ ok: boolean; err?: string }> = [];
    const client = new StratumWsClient(
      'ws://pool.test/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers({
        onSubmitResult: (ok, err) => results.push({ ok, err }),
      }),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
        clock,
        submitRetryMs: 50,
        backoffFirstMs: 5,
        backoffMaxMs: 5,
      },
    );
    client.connect();
    sockets[0]!.openNow();
    handshake(sockets[0]!);
    const en2a = new Uint8Array(8);
    const en2b = new Uint8Array(8);
    en2b[0] = 1;
    client.submit('job1', en2a, new Uint8Array(8), new Uint8Array(8));
    client.submit('job1', en2b, new Uint8Array(8), new Uint8Array(8));
    const firstSends = sockets[0]!.sent.filter((l) => l.includes('mining.submit'));
    expect(firstSends).toHaveLength(2);
    sockets[0]!.pushLine({ id: 11, error: null, result: true });
    expect(results).toEqual([{ ok: true }]);
    const retryIds = [...clock.timers.keys()];
    expect(retryIds.length).toBeGreaterThan(0);
    for (const id of retryIds) {
      clock.run(id);
    }
    const afterRetry = sockets[0]!.sent.filter((l) => l.includes('mining.submit'));
    expect(afterRetry.length).toBeGreaterThan(2);
    sockets[0]!.pushLine({ id: 12, error: [23, 'high-hash', null], result: false });
    expect(results).toHaveLength(2);
    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.err).toBe('Share was not hard enough');
    client.close();
  });

  it('flushes queued shares after reconnect with the same extraNonce1', () => {
    const sockets: FakeWebSocket[] = [];
    const clock = testClock();
    const client = new StratumWsClient(
      'ws://pool.test/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers(),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
        clock,
        submitRetryMs: 50,
        backoffFirstMs: 5,
        backoffMaxMs: 5,
      },
    );
    client.connect();
    sockets[0]!.openNow();
    handshake(sockets[0]!, 'aabbccdd');
    sockets[0]!.pushLine({
      method: 'mining.notify',
      params: ['job1', '11'.repeat(32), '22'.repeat(39), '', [], '00000000', '1e00ffff', '01020304'],
    });
    client.submit('job1', new Uint8Array(8), new Uint8Array(8), new Uint8Array(8));
    expect(sockets[0]!.sent.filter((l) => l.includes('mining.submit'))).toHaveLength(1);
    sockets[0]!.close();
    expect(clock.timers.size).toBe(1);
    clock.run([...clock.timers.keys()][0]!);
    expect(sockets).toHaveLength(2);
    sockets[1]!.openNow();
    const sub = JSON.parse(sockets[1]!.sent[0]!) as { params: string[] };
    expect(sub.params[1]).toBe(client.sessionId);
    handshake(sockets[1]!, 'aabbccdd');
    expect(sockets[1]!.sent.filter((l) => l.includes('mining.submit'))).toHaveLength(1);
    client.close();
  });

  it('drops queued shares when extraNonce1 changes', () => {
    const sockets: FakeWebSocket[] = [];
    const clock = testClock();
    const results: string[] = [];
    const client = new StratumWsClient(
      'ws://pool.test/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers({
        onSubmitResult: (ok, err) => {
          if (!ok) {
            results.push(err ?? '');
          }
        },
      }),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
        clock,
        submitRetryMs: 50,
        backoffFirstMs: 5,
        backoffMaxMs: 5,
      },
    );
    client.connect();
    sockets[0]!.openNow();
    handshake(sockets[0]!, 'aabbccdd');
    sockets[0]!.pushLine({
      method: 'mining.notify',
      params: ['job1', '11'.repeat(32), '22'.repeat(39), '', [], '00000000', '1e00ffff', '01020304'],
    });
    client.submit('job1', new Uint8Array(8), new Uint8Array(8), new Uint8Array(8));
    sockets[0]!.close();
    clock.run([...clock.timers.keys()][0]!);
    sockets[1]!.openNow();
    handshake(sockets[1]!, 'deadbeef');
    expect(results.some((m) => m.includes('extraNonce1'))).toBe(true);
    expect(sockets[1]!.sent.filter((l) => l.includes('mining.submit'))).toHaveLength(0);
    client.close();
  });

  it('reconnects while running and does not reconnect after stop', () => {
    const sockets: FakeWebSocket[] = [];
    const clock = testClock();
    let closed = '';
    const downs: string[] = [];
    const client = new StratumWsClient(
      'ws://pool.test/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers({
        onClose: (r) => {
          closed = r;
        },
        onDisconnected: (r) => downs.push(r),
      }),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
        clock,
        backoffFirstMs: 5,
        backoffMaxMs: 5,
      },
    );
    client.connect();
    sockets[0]!.openNow();
    handshake(sockets[0]!);
    sockets[0]!.close();
    expect(downs.length).toBeGreaterThan(0);
    expect(closed).toBe('');
    clock.run([...clock.timers.keys()][0]!);
    expect(sockets).toHaveLength(2);
    client.close();
    expect(closed).toBe('stopped');
    const after = clock.timers.size;
    expect(after).toBe(0);
  });

  it('calls onJobIgnored for a 38-byte coinb1 notify', () => {
    const sockets: FakeWebSocket[] = [];
    const ignored: string[] = [];
    const client = new StratumWsClient(
      'ws://pool.test/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers({
        onJobIgnored: (r) => ignored.push(r),
      }),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
      },
    );
    client.connect();
    sockets[0]!.openNow();
    handshake(sockets[0]!);
    sockets[0]!.pushLine({
      method: 'mining.notify',
      params: ['j', '11'.repeat(32), '22'.repeat(38), '', [], '20000000', '1e00ffff', '01020304', true],
    });
    expect(ignored).toEqual(['bad mining.notify (coinb1 38 bytes)']);
    client.close();
  });

  it('calls onDisconnected once for error then close on the same socket', () => {
    const sockets: FakeWebSocket[] = [];
    const clock = testClock();
    const downs: string[] = [];
    const client = new StratumWsClient(
      'ws://pool.test/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers({
        onDisconnected: (r) => downs.push(r),
      }),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
        clock,
        backoffFirstMs: 60_000,
        backoffMaxMs: 60_000,
      },
    );
    client.connect();
    sockets[0]!.openNow();
    handshake(sockets[0]!);
    sockets[0]!.errorNow();
    sockets[0]!.close();
    expect(downs).toEqual(['websocket error']);
    client.close();
  });

  it('does not treat a binary/ping frame as a dead socket', () => {
    const sockets: FakeWebSocket[] = [];
    const downs: string[] = [];
    const client = new StratumWsClient(
      'ws://pool.test/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers({
        onDisconnected: (r) => downs.push(r),
      }),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
      },
    );
    client.connect();
    sockets[0]!.openNow();
    handshake(sockets[0]!);
    sockets[0]!.pushRaw(new ArrayBuffer(2));
    expect(downs).toEqual([]);
    client.close();
  });

  it('parses client.pool_stats', () => {
    const stats = parsePoolStats({
      id: null,
      method: 'client.pool_stats',
      params: [
        {
          running: true,
          chain: 'testnet',
          height: 2,
          workers: 1,
          accepted: 7,
          rejected: 0,
          lastError: '',
          status: 'height 2',
          stratumHost: '127.0.0.1',
          stratumPort: 23334,
          datumHost: '127.0.0.1',
          datumPort: 28916,
          payouts: [{ miner: 'tgfcn1abc', sats: '34180' }],
          minerNet: '34180',
          operatorFee: '698',
          unfilledRemainder: '4999931640',
        },
      ],
    });
    expect(stats?.height).toBe(2);
    expect(stats?.payouts).toEqual([{ miner: 'tgfcn1abc', sats: '34180' }]);
    expect(stats?.minerNet).toBe('34180');
    expect(stats?.operatorFee).toBe('698');
    expect(stats?.unfilledRemainder).toBe('4999931640');
    expect(parsePoolStats({ method: 'mining.notify', params: [] })).toBeNull();
  });

  it('dispatches client.pool_stats to onPoolStats', () => {
    const sockets: FakeWebSocket[] = [];
    const heights: number[] = [];
    const client = new StratumWsClient(
      'ws://pool.test/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers({
        onPoolStats: (s) => heights.push(s.height),
      }),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
      },
    );
    client.connect();
    sockets[0]!.openNow();
    handshake(sockets[0]!);
    sockets[0]!.pushLine({
      method: 'client.pool_stats',
      params: [{ running: true, chain: 'testnet', height: 4, workers: 0, accepted: 0, rejected: 0 }],
    });
    expect(heights).toEqual([4]);
    client.close();
  });
});

describe('PoolStatsClient', () => {
  it('watches stats without mining.subscribe', () => {
    const sockets: FakeWebSocket[] = [];
    const heights: number[] = [];
    const client = new PoolStatsClient(
      'ws://pool.test/stratum',
      (s) => heights.push(s.height),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
      },
    );
    client.connect();
    sockets[0]!.openNow();
    expect(sockets[0]!.sent.some((l) => l.includes('client.watch_stats'))).toBe(true);
    expect(sockets[0]!.sent.some((l) => l.includes('mining.subscribe'))).toBe(false);
    expect(WATCH_STATS_LINE).toContain('client.watch_stats');
    sockets[0]!.pushLine({
      method: 'client.pool_stats',
      params: [{ running: true, chain: 'testnet', height: 2 }],
    });
    expect(heights).toEqual([2]);
    client.close();
  });
});

describe('client.gateway_info', () => {
  const withPrime = {
    node: { status: 'healthy' },
    pool: {
      name: 'House',
      coinbaseTag: 'TAG',
      websiteUrl: 'https://ex.example',
      prime: 'prime.example:28916',
      status: 'healthy',
    },
  };
  const withPrimeFields = {
    nodeStatus: 'healthy' as const,
    name: 'House',
    coinbaseTag: 'TAG',
    websiteUrl: 'https://ex.example',
    prime: 'prime.example:28916',
    poolStatus: 'healthy' as const,
  };
  const solo = {
    node: { status: 'healthy' },
    pool: { name: 'Local WSS test', coinbaseTag: 'DATUM Gateway', websiteUrl: 'https://mine.federationcoin.org' },
  };

  it('parses notify, result, JSON-RPC error, and rejects a flat old pool_info object', () => {
    expect(
      parseGatewayInfoNotify({
        id: null,
        method: 'client.gateway_info',
        params: [withPrime],
      }),
    ).toEqual(withPrimeFields);
    expect(parseGatewayInfoRpc({ id: 9, error: null, result: withPrime })).toEqual({
      kind: 'provided',
      fields: withPrimeFields,
    });
    expect(parseGatewayInfoRpc({ id: 9, error: [24, 'gateway info disabled', null], result: null })).toEqual({
      kind: 'notProvided',
    });
    expect(parseGatewayInfoNotify({ id: null, method: 'client.gateway_info', params: [solo] })).toEqual({
      nodeStatus: 'healthy',
      name: 'Local WSS test',
      coinbaseTag: 'DATUM Gateway',
      websiteUrl: 'https://mine.federationcoin.org',
    });
    expect(
      parseGatewayInfoRpc({
        id: 9,
        error: null,
        result: { prime: 'p.example:28916', name: 'House', coinbaseTag: 'TAG', websiteUrl: '' },
      }),
    ).toEqual({ kind: 'notProvided' });
    expect(JSON.parse(gatewayInfoLine())).toEqual({ id: 9, method: 'client.gateway_info', params: [] });
    expect(peerStatusLabel('healthy')).toBe('Healthy');
    expect(peerStatusLabel('not-healthy')).toBe('Not healthy');
    expect(
      parseGatewayInfoNotify({
        id: null,
        method: 'client.gateway_info',
        params: [{ node: { status: 'healthy' }, pool: { name: 'House', status: 'healthy' } }],
      }),
    ).toBeNull();
  });

  it('treats localhost and loopback gateway URLs as loopback', () => {
    expect(isLoopbackWsHost('ws://127.0.0.1:23335/stratum')).toBe(true);
    expect(isLoopbackWsHost('ws://localhost:23335/stratum')).toBe(true);
    expect(isLoopbackWsHost('ws://[::1]:23335/stratum')).toBe(true);
    expect(isLoopbackWsHost('wss://pool.example/stratum')).toBe(false);
  });

  it('sends client.gateway_info on open when onGatewayInfo is set and accepts an error without dropping mining', () => {
    const sockets: FakeWebSocket[] = [];
    const infos: string[] = [];
    const client = new StratumWsClient(
      'ws://127.0.0.1:23335/stratum',
      'tgfcn1abc.cpu',
      'x',
      silentHandlers({
        onGatewayInfo: (info) => infos.push(info.kind),
      }),
      {
        open: (url) => {
          const ws = new FakeWebSocket(url);
          sockets.push(ws);
          return ws as unknown as WebSocket;
        },
      },
    );
    client.connect();
    sockets[0]!.openNow();
    expect(sockets[0]!.sent.some((l) => l.includes('client.gateway_info'))).toBe(true);
    handshake(sockets[0]!);
    sockets[0]!.pushLine({ id: 9, error: [24, 'gateway info disabled', null], result: null });
    expect(infos).toEqual(['notProvided']);
    expect(client.isOpen()).toBe(true);
    client.requestGatewayInfo();
    expect(sockets[0]!.sent.filter((l) => l.includes('client.gateway_info')).length).toBe(2);
    client.close();
  });

  it('one-shot fetch closes after a result and does not subscribe', async () => {
    const sockets: FakeWebSocket[] = [];
    const pending = fetchGatewayInfo('ws://127.0.0.1:23335/stratum', {
      open: (url) => {
        const ws = new FakeWebSocket(url);
        sockets.push(ws);
        return ws as unknown as WebSocket;
      },
    });
    sockets[0]!.openNow();
    expect(sockets[0]!.sent.some((l) => l.includes('client.gateway_info'))).toBe(true);
    expect(sockets[0]!.sent.some((l) => l.includes('mining.subscribe'))).toBe(false);
    sockets[0]!.pushLine({
      id: 9,
      error: null,
      result: solo,
    });
    await expect(pending).resolves.toEqual({
      kind: 'provided',
      fields: {
        nodeStatus: 'healthy',
        name: 'Local WSS test',
        coinbaseTag: 'DATUM Gateway',
        websiteUrl: 'https://mine.federationcoin.org',
      },
    });
  });
});
