import { parseHex, toHex } from './asic-pow';
import { tidesSatsField, type MinerChain, type PoolStats, type TidesPayout } from './miner-api';
import { formatStratumReject } from './stratum-reject';

export const STRATUM_UA = 'federationcoin-web-miner/0.1';

/** Same caps as the desktop miner reconnect. Later: circuit breaker (see reconnect()). */
export const WS_BACKOFF_FIRST_MS = 1000;
export const WS_BACKOFF_MAX_MS = 60_000;
export const SUBMIT_RETRY_MS = 8_000;

export function nextWsBackoff(
  lastMs: number,
  firstMs = WS_BACKOFF_FIRST_MS,
  maxMs = WS_BACKOFF_MAX_MS,
): number {
  if (lastMs <= 0) {
    return firstMs;
  }
  return Math.min(maxMs, lastMs * 2);
}

export type StratumNotify = {
  jobId: string;
  prevHidden: Uint8Array;
  coinb1: Uint8Array;
  nBits: number;
  ntime8: Uint8Array;
};

export type StratumSubscribe = {
  extraNonce1: Uint8Array;
  extraNonce2Size: number;
};

export function subscribeLine(id = 1, sessionId?: string): string {
  const params = sessionId ? [STRATUM_UA, sessionId] : [STRATUM_UA];
  return JSON.stringify({ id, method: 'mining.subscribe', params });
}

export function authorizeLine(id: number, worker: string, password: string): string {
  return JSON.stringify({ id, method: 'mining.authorize', params: [worker, password] });
}

export function submitLine(
  id: number,
  worker: string,
  jobId: string,
  extraNonce2: Uint8Array,
  ntime8: Uint8Array,
  nonce8: Uint8Array,
): string {
  return JSON.stringify({
    id,
    method: 'mining.submit',
    params: [worker, jobId, toHex(extraNonce2), toHex(ntime8), toHex(nonce8)],
  });
}

export function shareBodyKey(
  jobId: string,
  extraNonce1: Uint8Array,
  extraNonce2: Uint8Array,
  ntime8: Uint8Array,
  nonce8: Uint8Array,
): string {
  return `${jobId}:${toHex(extraNonce1)}:${toHex(extraNonce2)}:${toHex(ntime8)}:${toHex(nonce8)}`;
}

export function parseSubscribeResult(msg: unknown): StratumSubscribe | null {
  if (!msg || typeof msg !== 'object') {
    return null;
  }
  const result = (msg as { result?: unknown }).result;
  if (!Array.isArray(result) || result.length < 3) {
    return null;
  }
  const en1 = result[1];
  const en2sz = result[2];
  if (typeof en1 !== 'string' || typeof en2sz !== 'number') {
    return null;
  }
  try {
    const extraNonce1 = parseHex(en1);
    if (extraNonce1.length !== 4) {
      return null;
    }
    if (!Number.isInteger(en2sz) || en2sz < 1 || en2sz > 16) {
      return null;
    }
    return { extraNonce1, extraNonce2Size: en2sz };
  } catch {
    return null;
  }
}

export function parseNotify(msg: unknown): StratumNotify | null {
  if (!msg || typeof msg !== 'object') {
    return null;
  }
  const rec = msg as { method?: unknown; params?: unknown };
  if (rec.method !== 'mining.notify' || !Array.isArray(rec.params) || rec.params.length < 7) {
    return null;
  }
  const params = rec.params;
  const jobId = params[0];
  const prev = params[1];
  const coinb1 = params[2];
  const merkleIsArray = Array.isArray(params[4]);
  const nbitsRaw = merkleIsArray ? params[6] : params[5];
  const ntimeRaw = merkleIsArray ? params[7] : params[6];
  if (typeof jobId !== 'string' || typeof prev !== 'string' || typeof coinb1 !== 'string') {
    return null;
  }
  if (typeof nbitsRaw !== 'string' || typeof ntimeRaw !== 'string') {
    return null;
  }
  try {
    const prevHidden = parseHex(prev);
    const coinb1b = parseHex(coinb1);
    const ntime = parseHex(ntimeRaw);
    if (prevHidden.length !== 32 || coinb1b.length !== 39) {
      return null;
    }
    if (ntime.length !== 4 && ntime.length !== 8) {
      return null;
    }
    const ntime8 = new Uint8Array(8);
    ntime8.set(ntime);
    const nBits = Number.parseInt(nbitsRaw, 16) >>> 0;
    if (!nBits) {
      return null;
    }
    return { jobId, prevHidden, coinb1: coinb1b, nBits, ntime8 };
  } catch {
    return null;
  }
}

/** Why parseNotify returned null. Keep the 39-byte DATUM coinb1 check. */
export function notifyIgnoreReason(msg: unknown): string {
  if (!msg || typeof msg !== 'object') {
    return 'bad mining.notify';
  }
  const rec = msg as { params?: unknown };
  if (!Array.isArray(rec.params) || rec.params.length < 3) {
    return 'bad mining.notify';
  }
  const coinb1 = rec.params[2];
  if (typeof coinb1 !== 'string') {
    return 'bad mining.notify';
  }
  try {
    const n = parseHex(coinb1).length;
    if (n !== 39) {
      return `bad mining.notify (coinb1 ${n} bytes)`;
    }
  } catch {
    return 'bad mining.notify (coinb1)';
  }
  return 'bad mining.notify';
}

export function parsePoolStats(msg: unknown): PoolStats | null {
  if (!msg || typeof msg !== 'object') {
    return null;
  }
  const rec = msg as { method?: unknown; params?: unknown };
  if (rec.method !== 'client.pool_stats' || !Array.isArray(rec.params) || rec.params.length < 1) {
    return null;
  }
  const raw = rec.params[0];
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as {
    running?: unknown;
    chain?: unknown;
    height?: unknown;
    workers?: unknown;
    accepted?: unknown;
    rejected?: unknown;
    lastError?: unknown;
    status?: unknown;
    stratumHost?: unknown;
    stratumPort?: unknown;
    datumHost?: unknown;
    datumPort?: unknown;
    payouts?: unknown;
    minerNet?: unknown;
    operatorFee?: unknown;
    unfilledRemainder?: unknown;
  };
  const chain: MinerChain | null = o.chain === 'main' ? 'main' : o.chain === 'testnet' ? 'testnet' : null;
  return {
    running: o.running !== false,
    chain,
    height: Number(o.height) || 0,
    workers: Number(o.workers) || 0,
    accepted: Number(o.accepted) || 0,
    rejected: Number(o.rejected) || 0,
    lastError: typeof o.lastError === 'string' ? o.lastError : '',
    status: typeof o.status === 'string' ? o.status : '',
    stratumHost: typeof o.stratumHost === 'string' ? o.stratumHost : '',
    stratumPort: Number(o.stratumPort) || 0,
    datumHost: typeof o.datumHost === 'string' ? o.datumHost : '',
    datumPort: Number(o.datumPort) || 0,
    payouts: parseTidesPayouts(o.payouts),
    minerNet: tidesSatsField(o.minerNet),
    operatorFee: tidesSatsField(o.operatorFee),
    unfilledRemainder: tidesSatsField(o.unfilledRemainder),
  };
}

function parseTidesPayouts(raw: unknown): TidesPayout[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: TidesPayout[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const miner = (row as { miner?: unknown }).miner;
    const sats = (row as { sats?: unknown }).sats;
    if (typeof miner === 'string' && (typeof sats === 'string' || typeof sats === 'number')) {
      out.push({ miner, sats: String(sats) });
    }
  }
  return out;
}

export function parseSetDifficulty(msg: unknown): number | null {
  if (!msg || typeof msg !== 'object') {
    return null;
  }
  const rec = msg as { method?: unknown; params?: unknown };
  if (rec.method !== 'mining.set_difficulty' || !Array.isArray(rec.params) || rec.params.length < 1) {
    return null;
  }
  const d = Number(rec.params[0]);
  if (!Number.isFinite(d) || d <= 0) {
    return null;
  }
  return d;
}

export type StratumWsHandlers = {
  onNotify: (job: StratumNotify) => void;
  onDifficulty: (diff: number) => void;
  onSubscribed: (sub: StratumSubscribe) => void;
  onAuthorized: () => void;
  onSubmitResult: (ok: boolean, error?: string) => void;
  onClose: (reason: string) => void;
  onJobIgnored: (reason: string) => void;
  onDisconnected?: (reason: string) => void;
  onPoolStats?: (stats: PoolStats) => void;
};

export type StratumWsClock = {
  now: () => number;
  schedule: (fn: () => void, ms: number) => number;
  cancel: (id: number) => void;
};

export type StratumWsTransport = {
  open: (url: string) => WebSocket;
  clock?: StratumWsClock;
  submitRetryMs?: number;
  backoffFirstMs?: number;
  backoffMaxMs?: number;
};

export function stratumWsUrl(host: string, port: number): string {
  const h = host.trim();
  if (h.startsWith('ws://') || h.startsWith('wss://')) {
    return h;
  }
  if (h.includes('/')) {
    return h;
  }
  const proto = h === '127.0.0.1' || h === 'localhost' ? 'ws' : 'wss';
  if (port === 443 || port === 80) {
    return `${proto}://${h}/stratum`;
  }
  return `${proto}://${h}:${port}/stratum`;
}

const STRATUM_TCP_PORT = 23334;
const DATUM_TCP_PORT = 28916;

function tcpStratumPort(port: number): boolean {
  return port === STRATUM_TCP_PORT || port === DATUM_TCP_PORT;
}

function tcpStratumHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'stratum.testnet.federationcoin.org' || h === 'datum.testnet.federationcoin.org';
}

/** TCP NLB / firmware ports. The browser cannot speak those; it needs wss:// on 443. */
export function isTcpStratumEndpoint(host: string, port: number): boolean {
  const raw = host.trim();
  const lower = raw.toLowerCase();
  if (lower.startsWith('ws://') || lower.startsWith('wss://')) {
    try {
      const u = new URL(raw);
      const p = u.port ? Number.parseInt(u.port, 10) : u.protocol === 'wss:' ? 443 : 80;
      return tcpStratumHost(u.hostname) || tcpStratumPort(p);
    } catch {
      return false;
    }
  }
  return tcpStratumHost(lower) || tcpStratumPort(port);
}

type OutboxItem = {
  key: string;
  jobId: string;
  extraNonce1: Uint8Array;
  extraNonce2: Uint8Array;
  ntime8: Uint8Array;
  nonce8: Uint8Array;
  rpcId: number;
  retryTimer: number | null;
};

function socketOpen(ws: WebSocket | null): ws is WebSocket {
  return !!ws && ws.readyState === 1;
}

export class StratumWsClient {
  private ws: WebSocket | null = null;
  private submitId = 10;
  private stopped = false;
  private buf = '';
  readonly sessionId: string;
  private extraNonce1 = new Uint8Array(4);
  private handshakeOk = false;
  private reconnectTimer: number | null = null;
  private backoffMs = 0;
  private readonly outbox = new Map<string, OutboxItem>();
  private readonly rpcToKey = new Map<number, string>();
  private curJobId = '';
  private prevJobId = '';
  private sockGen = 0;

  constructor(
    readonly url: string,
    readonly worker: string,
    readonly password: string,
    private readonly handlers: StratumWsHandlers,
    private readonly transport?: StratumWsTransport,
  ) {
    this.sessionId = crypto.randomUUID();
  }

  connect(): void {
    if (this.stopped) {
      return;
    }
    this.sockGen += 1;
    const gen = this.sockGen;
    const prev = this.ws;
    this.ws = null;
    this.handshakeOk = false;
    if (prev) {
      try {
        prev.close();
      } catch {
        /* ignore */
      }
    }
    const ws = this.transport?.open ? this.transport.open(this.url) : new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (gen !== this.sockGen || this.stopped) {
        return;
      }
      this.write(subscribeLine(1, this.sessionId));
      this.write(authorizeLine(2, this.worker, this.password));
    });
    ws.addEventListener('message', (ev: MessageEvent<string>) => {
      if (gen !== this.sockGen) {
        return;
      }
      if (typeof ev.data !== 'string') {
        return;
      }
      const text = ev.data;
      this.buf += text.endsWith('\n') ? text : `${text}\n`;
      for (;;) {
        const nl = this.buf.indexOf('\n');
        if (nl < 0) {
          break;
        }
        let line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }
        if (line) {
          this.onLine(line);
        }
      }
    });
    let deadOnce = false;
    const dead = (reason: string) => {
      if (gen !== this.sockGen || deadOnce) {
        return;
      }
      deadOnce = true;
      this.onSocketDead(reason);
    };
    ws.addEventListener('error', () => dead('websocket error'));
    ws.addEventListener('close', () => dead('connection closed'));
  }

  submit(jobId: string, extraNonce2: Uint8Array, ntime8: Uint8Array, nonce8: Uint8Array): void {
    if (this.stopped) {
      return;
    }
    const item: OutboxItem = {
      key: shareBodyKey(jobId, this.extraNonce1, extraNonce2, ntime8, nonce8),
      jobId,
      extraNonce1: this.extraNonce1.slice(),
      extraNonce2: extraNonce2.slice(),
      ntime8: ntime8.slice(),
      nonce8: nonce8.slice(),
      rpcId: 0,
      retryTimer: null,
    };
    if (this.outbox.has(item.key)) {
      return;
    }
    this.outbox.set(item.key, item);
    this.sendShare(item);
  }

  close(): void {
    this.stopped = true;
    this.cancelReconnect();
    for (const item of this.outbox.values()) {
      this.cancelRetry(item);
    }
    this.outbox.clear();
    this.rpcToKey.clear();
    this.sockGen += 1;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    this.handlers.onClose('stopped');
  }

  private clock(): StratumWsClock {
    return (
      this.transport?.clock ?? {
        now: () => Date.now(),
        schedule: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        cancel: (id) => {
          clearTimeout(id);
        },
      }
    );
  }

  private write(line: string): boolean {
    if (!socketOpen(this.ws)) {
      return false;
    }
    this.ws.send(`${line}\n`);
    return true;
  }

  private jobLive(jobId: string): boolean {
    return jobId === this.curJobId || jobId === this.prevJobId;
  }

  private sendShare(item: OutboxItem): void {
    if (this.stopped || !this.handshakeOk || !socketOpen(this.ws)) {
      return;
    }
    if (this.rpcToKey.has(item.rpcId)) {
      this.rpcToKey.delete(item.rpcId);
    }
    const rpcId = this.submitId++;
    item.rpcId = rpcId;
    this.rpcToKey.set(rpcId, item.key);
    this.write(submitLine(rpcId, this.worker, item.jobId, item.extraNonce2, item.ntime8, item.nonce8));
    this.armRetry(item);
  }

  private armRetry(item: OutboxItem): void {
    this.cancelRetry(item);
    const ms = this.transport?.submitRetryMs ?? SUBMIT_RETRY_MS;
    item.retryTimer = this.clock().schedule(() => {
      item.retryTimer = null;
      if (this.stopped || !this.outbox.has(item.key)) {
        return;
      }
      this.sendShare(item);
    }, ms);
  }

  private cancelRetry(item: OutboxItem): void {
    if (item.retryTimer != null) {
      this.clock().cancel(item.retryTimer);
      item.retryTimer = null;
    }
  }

  private dropShare(item: OutboxItem, reason: string): void {
    this.cancelRetry(item);
    if (item.rpcId) {
      this.rpcToKey.delete(item.rpcId);
    }
    this.outbox.delete(item.key);
    this.handlers.onSubmitResult(false, reason);
  }

  private flushOutbox(): void {
    const extraHex = toHex(this.extraNonce1);
    for (const item of [...this.outbox.values()]) {
      if (toHex(item.extraNonce1) !== extraHex) {
        this.dropShare(item, 'stale after reconnect (extraNonce1)');
        continue;
      }
      if (this.curJobId && !this.jobLive(item.jobId)) {
        this.dropShare(item, 'stale after reconnect (job)');
        continue;
      }
      this.sendShare(item);
    }
  }

  private noteJob(jobId: string): void {
    if (this.curJobId && this.curJobId !== jobId) {
      this.prevJobId = this.curJobId;
    }
    this.curJobId = jobId;
  }

  private onLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line) as unknown;
    } catch {
      this.onSocketDead('bad stratum json');
      return;
    }
    const rec = msg as { method?: unknown; id?: unknown; result?: unknown; error?: unknown };
    if (rec.method === 'client.pool_stats') {
      const stats = parsePoolStats(msg);
      if (stats) {
        this.handlers.onPoolStats?.(stats);
      }
      return;
    }
    if (rec.method === 'mining.notify') {
      const job = parseNotify(msg);
      if (job) {
        this.noteJob(job.jobId);
        this.handlers.onNotify(job);
      } else {
        this.handlers.onJobIgnored(notifyIgnoreReason(msg));
      }
      return;
    }
    if (rec.method === 'mining.set_difficulty') {
      const diff = parseSetDifficulty(msg);
      if (diff != null) {
        this.handlers.onDifficulty(diff);
      }
      return;
    }
    if (rec.id === 1) {
      const sub = parseSubscribeResult(msg);
      if (sub) {
        this.extraNonce1 = sub.extraNonce1.slice();
        this.handlers.onSubscribed(sub);
      }
      return;
    }
    if (rec.id === 2 && rec.result === true && rec.error == null) {
      this.handshakeOk = true;
      this.backoffMs = 0;
      this.handlers.onAuthorized();
      this.flushOutbox();
      return;
    }
    if (typeof rec.id === 'number' && rec.id >= 10) {
      const key = this.rpcToKey.get(rec.id);
      if (!key) {
        return;
      }
      const item = this.outbox.get(key);
      this.rpcToKey.delete(rec.id);
      if (!item) {
        return;
      }
      this.cancelRetry(item);
      this.outbox.delete(key);
      const ok = rec.result === true && rec.error == null;
      const err = rec.error == null ? undefined : formatStratumReject(rec.error);
      this.handlers.onSubmitResult(ok, err);
    }
  }

  private onSocketDead(reason: string): void {
    this.ws = null;
    this.handshakeOk = false;
    this.rpcToKey.clear();
    for (const item of this.outbox.values()) {
      this.cancelRetry(item);
      item.rpcId = 0;
    }
    if (this.stopped) {
      return;
    }
    this.handlers.onDisconnected?.(reason);
    this.scheduleReconnect();
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer != null) {
      this.clock().cancel(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Capped reconnect so a flap is not a tight loop. Do not add a circuit breaker
   * here yet. If we later see a burst of load-shaped failures (HTTP 429/502/503,
   * submit timeouts, socket errors, or WS drops that force a full reconnect),
   * open a breaker and back off instead of amplifying load on our own pool.
   */
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer != null) {
      return;
    }
    this.backoffMs = nextWsBackoff(
      this.backoffMs,
      this.transport?.backoffFirstMs ?? WS_BACKOFF_FIRST_MS,
      this.transport?.backoffMaxMs ?? WS_BACKOFF_MAX_MS,
    );
    this.reconnectTimer = this.clock().schedule(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        this.connect();
      }
    }, this.backoffMs);
  }
}

export const WATCH_STATS_LINE = JSON.stringify({ id: null, method: 'client.watch_stats', params: [] });

/** Idle SPA: same /stratum URL, stats only. Close this before opening StratumWsClient. */
export class PoolStatsClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private sockGen = 0;
  private reconnectTimer: number | null = null;
  private backoffMs = 0;

  constructor(
    readonly url: string,
    private readonly onStats: (stats: PoolStats) => void,
    private readonly transport?: StratumWsTransport,
  ) {}

  connect(): void {
    if (this.stopped) {
      return;
    }
    this.sockGen += 1;
    const gen = this.sockGen;
    const prev = this.ws;
    this.ws = null;
    if (prev) {
      try {
        prev.close();
      } catch {
        /* ignore */
      }
    }
    const ws = this.transport?.open ? this.transport.open(this.url) : new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (gen !== this.sockGen || this.stopped) {
        return;
      }
      if (ws.readyState === 1) {
        ws.send(`${WATCH_STATS_LINE}\n`);
      }
    });
    ws.addEventListener('message', (ev: MessageEvent<string>) => {
      if (gen !== this.sockGen || typeof ev.data !== 'string') {
        return;
      }
      for (const part of ev.data.split('\n')) {
        const line = part.replace(/\r$/, '').trim();
        if (!line) {
          continue;
        }
        let msg: unknown;
        try {
          msg = JSON.parse(line) as unknown;
        } catch {
          continue;
        }
        const stats = parsePoolStats(msg);
        if (stats) {
          this.onStats(stats);
        }
      }
    });
    let deadOnce = false;
    const dead = () => {
      if (gen !== this.sockGen || deadOnce) {
        return;
      }
      deadOnce = true;
      this.onSocketDead();
    };
    ws.addEventListener('error', () => dead());
    ws.addEventListener('close', () => dead());
  }

  close(): void {
    this.stopped = true;
    this.cancelReconnect();
    this.sockGen += 1;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  }

  private clock(): StratumWsClock {
    return (
      this.transport?.clock ?? {
        now: () => Date.now(),
        schedule: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        cancel: (id) => {
          clearTimeout(id);
        },
      }
    );
  }

  private onSocketDead(): void {
    this.ws = null;
    if (this.stopped) {
      return;
    }
    this.scheduleReconnect();
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer != null) {
      this.clock().cancel(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer != null) {
      return;
    }
    this.backoffMs = nextWsBackoff(
      this.backoffMs,
      this.transport?.backoffFirstMs ?? WS_BACKOFF_FIRST_MS,
      this.transport?.backoffMaxMs ?? WS_BACKOFF_MAX_MS,
    );
    this.reconnectTimer = this.clock().schedule(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        this.connect();
      }
    }, this.backoffMs);
  }
}
