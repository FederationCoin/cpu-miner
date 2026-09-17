import { createConnection, type Socket } from 'node:net';
import { parseHex, toHex } from './bytes.js';

export const STRATUM_HOST = '127.0.0.1';
export const STRATUM_PORT = 23334;
export const STRATUM_UA = 'federationcoin-cpu-miner/0.1';

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

export function subscribeLine(id = 1): string {
  return JSON.stringify({ id, method: 'mining.subscribe', params: [STRATUM_UA] });
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

export function isAuthorizeOk(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') {
    return false;
  }
  const rec = msg as { id?: unknown; result?: unknown; error?: unknown };
  return rec.id === 2 && rec.result === true && rec.error == null;
}

export type StratumHandlers = {
  onNotify: (job: StratumNotify) => void;
  onDifficulty: (diff: number) => void;
  onSubscribed: (sub: StratumSubscribe) => void;
  onAuthorized: () => void;
  onSubmitResult: (ok: boolean, error?: string) => void;
  onClose: (reason: string) => void;
  onJobIgnored: (reason: string) => void;
};

export class StratumClient {
  private sock: Socket | null = null;
  private buf = '';
  private submitId = 10;
  private closed = false;

  constructor(
    readonly host: string,
    readonly port: number,
    readonly worker: string,
    readonly password: string,
    private readonly handlers: StratumHandlers,
  ) {}

  connect(): void {
    const sock = createConnection({ host: this.host, port: this.port });
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.on('connect', () => {
      this.write(subscribeLine(1));
      this.write(authorizeLine(2, this.worker, this.password));
    });
    sock.on('data', (chunk: string) => {
      this.buf += chunk;
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
    sock.on('error', (err) => {
      this.finish(err.message);
    });
    sock.on('close', () => {
      this.finish('connection closed');
    });
  }

  submit(jobId: string, extraNonce2: Uint8Array, ntime8: Uint8Array, nonce8: Uint8Array): void {
    this.write(submitLine(this.submitId++, this.worker, jobId, extraNonce2, ntime8, nonce8));
  }

  close(): void {
    this.finish('stopped');
  }

  private write(line: string): void {
    this.sock?.write(line + '\n');
  }

  private onLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line) as unknown;
    } catch {
      this.finish('bad stratum json');
      return;
    }
    const rec = msg as { method?: unknown; id?: unknown; result?: unknown; error?: unknown };
    if (rec.method === 'mining.notify') {
      const job = parseNotify(msg);
      if (job) {
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
        this.handlers.onSubscribed(sub);
      }
      return;
    }
    if (isAuthorizeOk(msg)) {
      this.handlers.onAuthorized();
      return;
    }
    if (typeof rec.id === 'number' && rec.id >= 10) {
      const ok = rec.result === true && rec.error == null;
      const err =
        rec.error == null ? undefined : typeof rec.error === 'string' ? rec.error : JSON.stringify(rec.error);
      this.handlers.onSubmitResult(ok, err);
    }
  }

  private finish(reason: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const s = this.sock;
    this.sock = null;
    s?.removeAllListeners();
    s?.destroy();
    this.handlers.onClose(reason);
  }
}
