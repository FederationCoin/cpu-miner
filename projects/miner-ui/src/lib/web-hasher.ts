import {
  asicPowHash,
  datumWorkHeader,
  datumWorkRoot,
  grindTargetForShare,
  hashMeetsTarget,
  toHex,
  writeLe32,
} from './asic-pow';
import type { HasherHost } from './hasher-host';
import type {
  GpuScan,
  MinerInfo,
  MinerStartOpts,
  MinerStats,
  PoolStartOpts,
  PoolStats,
} from './miner-api';
import type { HostedEndpoints } from './miner-shell';
import { StratumWsClient, stratumWsUrl, type StratumNotify, type StratumWsTransport } from './stratum-ws';
import { scanWebGpu, webgpuGrind } from './webgpu';

export const IDLE_WEB_STATS: MinerStats = {
  running: false,
  chain: null,
  hashrate: 0,
  height: 0,
  hashes: 0,
  accepted: 0,
  rejected: 0,
  lastError: '',
  lastHash: '',
  status: 'idle',
};

export const IDLE_WEB_POOL: PoolStats = {
  running: false,
  chain: null,
  height: 0,
  workers: 0,
  accepted: 0,
  rejected: 0,
  lastError: '',
  status: 'idle',
  stratumHost: '',
  stratumPort: 0,
  datumHost: '',
  datumPort: 0,
  payouts: [],
};

export class WebHasherHost implements HasherHost {
  readonly canMine = true;
  readonly inElectron = false;
  private running = false;
  private stopFlag = false;
  private statsState: MinerStats = { ...IDLE_WEB_STATS };
  private poolState: PoolStats = { ...IDLE_WEB_POOL };
  private statsCbs: Array<(s: MinerStats) => void> = [];
  private toastCbs: Array<(m: string) => void> = [];
  private poolCbs: Array<(s: PoolStats) => void> = [];
  private client: StratumWsClient | null = null;
  private hashes = 0;
  private lastRateAt = Date.now();
  private hashesWindow = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private grindTimer: ReturnType<typeof setTimeout> | null = null;
  private nonce = 0;
  private gpuIds: string[] = [];

  constructor(
    private readonly hosted: HostedEndpoints,
    private readonly wsTransport?: StratumWsTransport,
  ) {
    this.startPoolPoll();
  }

  async start(opts: MinerStartOpts): Promise<{ ok: boolean; error?: string }> {
    if (opts.chain === 'main' && opts.mineTo.kind === 'hostedPoolStratum') {
      return { ok: false, error: 'Federation pool is not offered on main' };
    }
    await this.stop();
    const url = this.stratumUrl(opts);
    if (!url) {
      return { ok: false, error: this.startError(opts) };
    }
    const worker =
      opts.mineTo.kind === 'hostedPoolStratum'
        ? opts.mineTo.worker
        : opts.mineTo.kind === 'stratum'
          ? opts.mineTo.stratum.worker
          : '';
    const password =
      opts.mineTo.kind === 'hostedPoolStratum'
        ? opts.mineTo.password
        : opts.mineTo.kind === 'stratum'
          ? opts.mineTo.stratum.password
          : 'x';
    if (!worker.trim()) {
      return { ok: false, error: 'worker is empty' };
    }
    this.gpuIds = opts.gpuIds ?? [];
    this.running = true;
    this.stopFlag = false;
    this.hashes = 0;
    this.hashesWindow = 0;
    this.statsState = {
      ...IDLE_WEB_STATS,
      running: true,
      chain: opts.chain,
      status: `connecting ${url}`,
    };
    this.emitStats();
    const threads = Math.max(1, Math.min(16, opts.threads | 0));
    let extraNonce1 = new Uint8Array(4);
    let shareDiff = 1n;
    const client = new StratumWsClient(url, worker.trim(), password, {
      onSubscribed: (sub) => {
        extraNonce1 = new Uint8Array(sub.extraNonce1);
      },
      onDifficulty: (diff) => {
        shareDiff = BigInt(Math.max(1, Math.floor(diff)));
      },
      onAuthorized: () => {
        this.statsState.status = `authorized ${worker.trim()}`;
        this.emitStats();
      },
      onNotify: (job) => {
        const target = grindTargetForShare(job.nBits, shareDiff);
        if (!target) {
          this.toast('bad nBits');
          return;
        }
        this.beginGrind(client, job, extraNonce1, target, threads);
      },
      onSubmitResult: (ok, error) => {
        if (ok) {
          this.statsState.accepted++;
          this.statsState.status = 'share accepted';
          this.statsState.lastError = '';
        } else {
          this.statsState.rejected++;
          this.statsState.lastError = error ?? 'share rejected';
          this.toast(this.statsState.lastError);
        }
        this.emitStats();
      },
      onDisconnected: (reason) => {
        if (this.client !== client) {
          return;
        }
        this.statsState.lastError = reason;
        this.statsState.status = `reconnecting (${reason})`;
        this.emitStats();
      },
      onClose: (reason) => {
        if (this.client !== client) {
          return;
        }
        this.client = null;
        if (this.running && !this.stopFlag) {
          this.statsState.lastError = reason;
          this.statsState.status = 'disconnected';
          this.emitStats();
          this.toast(reason);
        }
      },
    }, this.wsTransport);
    this.client = client;
    client.connect();
    return { ok: true };
  }

  async stop(): Promise<void> {
    this.stopFlag = true;
    this.running = false;
    this.client?.close();
    this.client = null;
    if (this.grindTimer) {
      clearTimeout(this.grindTimer);
      this.grindTimer = null;
    }
    this.statsState = { ...IDLE_WEB_STATS };
    this.emitStats();
  }

  async info(): Promise<MinerInfo | null> {
    const cores = globalThis.navigator?.hardwareConcurrency ?? 4;
    return {
      cookiePath: '',
      datadir: '',
      rpc: '',
      electron: false,
      defaultThreads: Math.max(1, Math.min(8, cores)),
    };
  }

  async gpus(): Promise<GpuScan> {
    const devices = await scanWebGpu();
    return { devices, addon: devices.length > 0 };
  }

  pickDatadir(): Promise<string | null> {
    return Promise.resolve(null);
  }

  onStats(cb: (s: MinerStats) => void): () => void {
    this.statsCbs.push(cb);
    return () => {
      this.statsCbs = this.statsCbs.filter((c) => c !== cb);
    };
  }

  onToast(cb: (message: string) => void): () => void {
    this.toastCbs.push(cb);
    return () => {
      this.toastCbs = this.toastCbs.filter((c) => c !== cb);
    };
  }

  async poolStart(_opts: PoolStartOpts): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: 'The cloud pool is already running. Settings are not editable here.' };
  }

  async poolStop(): Promise<void> {
    /* hosted pool is not stopped from the browser */
  }

  onPoolStats(cb: (s: PoolStats) => void): () => void {
    this.poolCbs.push(cb);
    cb(this.poolState);
    return () => {
      this.poolCbs = this.poolCbs.filter((c) => c !== cb);
    };
  }

  private stratumUrl(opts: MinerStartOpts): string | null {
    if (opts.mineTo.kind === 'hostedPoolStratum') {
      return this.hosted.stratumWss;
    }
    if (opts.mineTo.kind === 'stratum') {
      return stratumWsUrl(opts.mineTo.stratum.host, opts.mineTo.stratum.port);
    }
    return null;
  }

  private startError(opts: MinerStartOpts): string {
    if (opts.mineTo.kind === 'node' || opts.mineTo.kind === 'datum' || opts.mineTo.kind === 'appPoolDatum') {
      return 'DATUM is bring your own node. Use the desktop app with your own node.';
    }
    if (opts.mineTo.kind === 'appPoolStratum') {
      return 'App pool is desktop-only. Mine the hosted testnet pool or a Stratum URL.';
    }
    return 'This web demo mines over WebSocket Stratum only.';
  }

  private beginGrind(
    client: StratumWsClient,
    job: StratumNotify,
    extraNonce1: Uint8Array,
    target: Uint8Array,
    threads: number,
  ): void {
    if (this.grindTimer) {
      clearTimeout(this.grindTimer);
      this.grindTimer = null;
    }
    this.nonce = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const extraNonce2 = new Uint8Array(8);
    writeLe32(extraNonce2, 0, 1);
    const extraNonce12 = new Uint8Array(12);
    extraNonce12.set(extraNonce1, 0);
    extraNonce12.set(extraNonce2, 4);
    const root = datumWorkRoot(job.coinb1, extraNonce12);
    const nonce8 = new Uint8Array(8);
    const work = datumWorkHeader(job.prevHidden, nonce8, job.ntime8, root);
    const useGpu = this.gpuIds.includes('webgpu:0');
    const step = () => {
      if (!this.running || this.stopFlag || this.client !== client) {
        return;
      }
      void this.grindBatch(client, job, work, extraNonce2, target, threads, useGpu).then(() => {
        if (this.running && !this.stopFlag && this.client === client) {
          this.grindTimer = setTimeout(step, 0);
        }
      });
    };
    this.statsState.status = `mining ${job.jobId}`;
    this.emitStats();
    step();
  }

  private async grindBatch(
    client: StratumWsClient,
    job: StratumNotify,
    workTemplate: Uint8Array,
    extraNonce2: Uint8Array,
    target: Uint8Array,
    threads: number,
    useGpu: boolean,
  ): Promise<void> {
    const work = new Uint8Array(workTemplate);
    if (useGpu) {
      const r = await webgpuGrind(work, target, this.nonce >>> 0, 0, 4096, 16);
      this.noteHashes(r.hashes);
      if (r.nonce !== undefined) {
        this.submitFound(client, job, extraNonce2, work, r.nonce, r.nonce2 ?? 0);
      } else {
        this.nonce = (this.nonce + r.hashes) >>> 0;
      }
      return;
    }
    const batch = Math.max(256, threads * 256);
    for (let i = 0; i < batch; i++) {
      const n = (this.nonce + i) >>> 0;
      writeLe32(work, 32, n);
      writeLe32(work, 36, 0);
      const h = asicPowHash(work);
      if (hashMeetsTarget(h, target)) {
        this.noteHashes(i + 1);
        this.submitFound(client, job, extraNonce2, work, n, 0);
        this.nonce = (n + 1) >>> 0;
        return;
      }
    }
    this.noteHashes(batch);
    this.nonce = (this.nonce + batch) >>> 0;
  }

  private submitFound(
    client: StratumWsClient,
    job: StratumNotify,
    extraNonce2: Uint8Array,
    work: Uint8Array,
    nonce: number,
    nonce2: number,
  ): void {
    const nonce8 = new Uint8Array(8);
    writeLe32(nonce8, 0, nonce);
    writeLe32(nonce8, 4, nonce2);
    this.statsState.lastHash = toHex(nonce8);
    client.submit(job.jobId, extraNonce2, work.slice(40, 48), nonce8);
    this.emitStats();
  }

  private noteHashes(n: number): void {
    this.hashes += n;
    this.hashesWindow += n;
    this.statsState.hashes = this.hashes;
    const now = Date.now();
    const dt = now - this.lastRateAt;
    if (dt >= 500) {
      this.statsState.hashrate = (this.hashesWindow * 1000) / dt;
      this.hashesWindow = 0;
      this.lastRateAt = now;
      this.emitStats();
    }
  }

  private startPoolPoll(): void {
    const tick = (): void => {
      void this.refreshHostedStats();
    };
    tick();
    this.pollTimer = setInterval(tick, 3000);
  }

  private async refreshHostedStats(): Promise<void> {
    try {
      const r = await fetch(this.hosted.statsUrl, { cache: 'no-store' });
      if (!r.ok) {
        return;
      }
      const raw = (await r.json()) as Partial<PoolStats>;
      this.poolState = {
        ...IDLE_WEB_POOL,
        running: raw.running !== false,
        chain: raw.chain === 'main' ? 'main' : 'testnet',
        height: Number(raw.height) || 0,
        workers: Number(raw.workers) || 0,
        accepted: Number(raw.accepted) || 0,
        rejected: Number(raw.rejected) || 0,
        lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
        status: typeof raw.status === 'string' ? raw.status : 'hosted',
        stratumHost: this.hosted.stratumTcp.host,
        stratumPort: this.hosted.stratumTcp.port,
        datumHost: this.hosted.datumTcp.host,
        datumPort: this.hosted.datumTcp.port,
        payouts: Array.isArray(raw.payouts) ? raw.payouts : [],
      };
      for (const cb of this.poolCbs) {
        cb(this.poolState);
      }
    } catch {
      this.poolState = {
        ...IDLE_WEB_POOL,
        running: true,
        chain: 'testnet',
        status: 'FederationCoin testnet pool (status unreachable)',
        stratumHost: this.hosted.stratumTcp.host,
        stratumPort: this.hosted.stratumTcp.port,
        datumHost: this.hosted.datumTcp.host,
        datumPort: this.hosted.datumTcp.port,
      };
      for (const cb of this.poolCbs) {
        cb(this.poolState);
      }
    }
  }

  private emitStats(): void {
    for (const cb of this.statsCbs) {
      cb(this.statsState);
    }
  }

  private toast(message: string): void {
    for (const cb of this.toastCbs) {
      cb(message);
    }
  }
}
