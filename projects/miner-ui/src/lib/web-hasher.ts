import {
  asicPowHash,
  datumWorkHeader,
  datumWorkRoot,
  grindTargetForShare,
  hashMeetsTarget,
  targetFromCompact,
  toHex,
  writeLe32,
} from './asic-pow';
import type { HasherHost } from './hasher-host';
import {
  tidesSatsField,
  isWebStratumMineTo,
  STRATUM_PASSWORD,
  type GpuScan,
  type MinerInfo,
  type MinerStartOpts,
  type MinerStats,
  type MinerToast,
  type PoolStartOpts,
  type PoolStats,
} from './miner-api';
import type { HostedEndpoints } from './miner-shell';
import {
  StratumWsClient,
  fetchGatewayInfo,
  type GatewayInfoRpc,
  type StratumNotify,
  type StratumWsTransport,
} from './stratum-ws';
import { webgpuGrind } from './webgpu';
import { parseGpuPicks, type GpuPick } from './gpu-catalog';

export const GRIND_GRACE_MS = 3000;

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
  link: 'idle',
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
  minerNet: '0',
  operatorFee: '0',
  unfilledRemainder: '0',
};

export class WebHasherHost implements HasherHost {
  readonly canMine = true;
  readonly inElectron = false;
  private running = false;
  private stopFlag = false;
  private socketLive = false;
  private grindUntil = 0;
  private statsState: MinerStats = { ...IDLE_WEB_STATS };
  private poolState: PoolStats = { ...IDLE_WEB_POOL };
  private statsCbs: Array<(s: MinerStats) => void> = [];
  private toastCbs: Array<(t: MinerToast) => void> = [];
  private poolCbs: Array<(s: PoolStats) => void> = [];
  private gatewayInfoCbs: Array<(info: GatewayInfoRpc) => void> = [];
  private client: StratumWsClient | null = null;
  private hashes = 0;
  private lastRateAt = Date.now();
  private hashesWindow = 0;
  private grindTimer: number | null = null;
  private graceTimer: number | null = null;
  private nonce = 0;
  private gpuPicks: GpuPick[] = [];

  constructor(
    private readonly hosted: HostedEndpoints,
    private readonly wsTransport?: StratumWsTransport,
  ) {}

  async start(opts: MinerStartOpts): Promise<{ ok: boolean; error?: string }> {
    this.stopMining();
    this.stopStatsWatch();
    const url = this.stratumUrl(opts);
    if (!url) {
      return { ok: false, error: this.startError(opts) };
    }
    if (!isWebStratumMineTo(opts.mineTo)) {
      return { ok: false, error: this.startError(opts) };
    }
    const worker = opts.mineTo.worker;
    if (!worker.trim()) {
      return { ok: false, error: 'worker is empty' };
    }
    this.gpuPicks = parseGpuPicks(opts.gpus);
    this.running = true;
    this.stopFlag = false;
    this.socketLive = false;
    this.hashes = 0;
    this.hashesWindow = 0;
    this.lastRateAt = this.now();
    this.statsState = {
      ...IDLE_WEB_STATS,
      running: true,
      chain: opts.chain,
      status: `connecting ${url}`,
      link: 'down',
      height: this.poolState.height,
    };
    this.emitStats();
    const threads = Math.max(1, Math.min(16, opts.threads | 0));
    let extraNonce1 = new Uint8Array(4);
    let shareDiff = 1n;
    let lastJob: StratumNotify | null = null;
    const watchPoolStats = opts.mineTo.kind === 'stratumPoolWebsocket';
    const watchGatewayInfo = opts.mineTo.kind === 'datumGatewayWebsocket';
    const client = new StratumWsClient(url, worker.trim(), STRATUM_PASSWORD, {
      onSubscribed: (sub) => {
        extraNonce1 = new Uint8Array(sub.extraNonce1);
      },
      onDifficulty: (diff) => {
        shareDiff = BigInt(Math.max(1, Math.floor(diff)));
      },
      onAuthorized: () => {
        this.socketLive = true;
        this.cancelGrace();
        this.statsState.link = 'up';
        this.statsState.lastError = '';
        this.statsState.status = `authorized ${worker.trim()}`;
        this.emitStats();
      },
      onNotify: (job) => {
        lastJob = job;
        this.socketLive = true;
        this.cancelGrace();
        this.statsState.link = 'up';
        const target = grindTargetForShare(job.nBits, shareDiff);
        if (!target) {
          this.toast('bad nBits');
          return;
        }
        this.beginGrind(client, job, extraNonce1, target, threads);
      },
      onJobIgnored: (reason) => {
        this.statsState.lastError = reason;
        this.statsState.status = reason;
        this.emitStats();
        this.toast(reason);
      },
      onSubmitResult: (ok, error) => {
        if (ok) {
          this.statsState.accepted++;
          this.statsState.status = 'share accepted';
          this.statsState.lastError = '';
          if (lastJob) {
            const block = targetFromCompact(lastJob.nBits);
            if (block) {
              this.beginGrind(client, lastJob, extraNonce1, block, threads);
            }
          }
        } else {
          this.statsState.rejected++;
          this.statsState.lastError = error ?? 'Share rejected';
          this.toast(this.statsState.lastError);
        }
        this.emitStats();
      },
      onDisconnected: (reason) => {
        if (this.client !== client) {
          return;
        }
        this.socketLive = false;
        this.statsState.link = 'down';
        this.statsState.status = `reconnecting (${reason})`;
        this.emitStats();
        this.toast(reason);
        this.armGrindPause();
      },
      onClose: (reason) => {
        if (this.client !== client) {
          return;
        }
        this.client = null;
        this.socketLive = false;
        if (this.running && !this.stopFlag) {
          this.statsState.link = 'down';
          this.statsState.status = 'disconnected';
          this.emitStats();
          this.toast(reason);
        }
      },
      onPoolStats: watchPoolStats
        ? (stats) => {
            this.applyPoolStats(stats);
          }
        : undefined,
      onGatewayInfo: watchGatewayInfo
        ? (info) => {
            this.emitGatewayInfo(info);
          }
        : undefined,
    }, this.wsTransport);
    this.client = client;
    client.connect();
    return { ok: true };
  }

  async stop(): Promise<void> {
    this.stopMining();
    this.statsState = { ...IDLE_WEB_STATS };
    this.emitStats();
  }

  /** Tests and page unload. Idle house stats watch is gone. */
  stopWatch(): void {
    this.stopStatsWatch();
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
    return { devices: [], addon: false };
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

  onToast(cb: (toast: MinerToast) => void): () => void {
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

  miningSocketOpen(): boolean {
    return this.client?.isOpen() ?? false;
  }

  requestGatewayInfo(): boolean {
    return this.client?.requestGatewayInfo() ?? false;
  }

  fetchGatewayInfo(url: string): Promise<GatewayInfoRpc> {
    return fetchGatewayInfo(url, this.wsTransport);
  }

  onGatewayInfo(cb: (info: GatewayInfoRpc) => void): () => void {
    this.gatewayInfoCbs.push(cb);
    return () => {
      this.gatewayInfoCbs = this.gatewayInfoCbs.filter((c) => c !== cb);
    };
  }

  private emitGatewayInfo(info: GatewayInfoRpc): void {
    for (const cb of this.gatewayInfoCbs) {
      cb(info);
    }
  }

  private stratumUrl(opts: MinerStartOpts): string | null {
    if (isWebStratumMineTo(opts.mineTo)) {
      const url = opts.mineTo.url.trim();
      return url || null;
    }
    return null;
  }

  private startError(opts: MinerStartOpts): string {
    if (opts.mineTo.kind === 'stratum') {
      return 'TCP Stratum is for the desktop app and firmware. This page uses Stratum Websocket.';
    }
    if (opts.mineTo.kind === 'node') {
      return 'Node RPC is desktop-only. This page mines over WebSocket Stratum.';
    }
    return 'This web demo mines over WebSocket Stratum only.';
  }

  private stopMining(): void {
    this.stopFlag = true;
    this.running = false;
    this.socketLive = false;
    this.clearGrind();
    this.cancelGrace();
    const client = this.client;
    this.client = null;
    client?.close();
  }

  private stopStatsWatch(): void {
    /* pool_stats arrive on the mining socket for stratumPoolWebsocket only */
  }

  private applyPoolStats(raw: PoolStats): void {
    this.poolState = {
      ...IDLE_WEB_POOL,
      running: raw.running !== false,
      chain: raw.chain === 'main' ? 'main' : raw.chain === 'testnet' ? 'testnet' : this.poolState.chain,
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
      minerNet: tidesSatsField(raw.minerNet),
      operatorFee: tidesSatsField(raw.operatorFee),
      unfilledRemainder: tidesSatsField(raw.unfilledRemainder),
    };
    if (this.running) {
      this.statsState.height = this.poolState.height;
      this.emitStats();
    }
    for (const cb of this.poolCbs) {
      cb(this.poolState);
    }
  }

  private beginGrind(
    client: StratumWsClient,
    job: StratumNotify,
    extraNonce1: Uint8Array,
    target: Uint8Array,
    threads: number,
  ): void {
    this.clearGrind();
    this.nonce = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const extraNonce2 = new Uint8Array(8);
    writeLe32(extraNonce2, 0, 1);
    const extraNonce12 = new Uint8Array(12);
    extraNonce12.set(extraNonce1, 0);
    extraNonce12.set(extraNonce2, 4);
    const root = datumWorkRoot(job.coinb1, extraNonce12);
    const nonce8 = new Uint8Array(8);
    const work = datumWorkHeader(job.prevHidden, nonce8, job.ntime8, root);
    const useGpu = this.gpuPicks.some((p) => p.strategy.kind === 'webgpu');
    const step = () => {
      if (!this.grindMayRun(client)) {
        return;
      }
      void this.grindBatch(client, job, work, extraNonce2, target, threads, useGpu).then(() => {
        if (this.grindMayRun(client)) {
          this.grindTimer = this.schedule(step, 0);
        }
      });
    };
    this.statsState.status = `mining ${job.jobId}`;
    this.emitStats();
    step();
  }

  private grindMayRun(client: StratumWsClient): boolean {
    if (!this.running || this.stopFlag || this.client !== client) {
      return false;
    }
    if (this.socketLive) {
      return true;
    }
    return this.now() < this.grindUntil;
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
    const now = this.now();
    const dt = now - this.lastRateAt;
    if (dt >= 500) {
      this.statsState.hashrate = (this.hashesWindow * 1000) / dt;
      this.hashesWindow = 0;
      this.lastRateAt = now;
    }
    this.emitStats();
  }

  private armGrindPause(): void {
    this.cancelGrace();
    this.grindUntil = this.now() + GRIND_GRACE_MS;
    this.graceTimer = this.schedule(() => {
      this.graceTimer = null;
      if (this.socketLive) {
        return;
      }
      this.clearGrind();
      this.statsState.hashrate = 0;
      this.emitStats();
    }, GRIND_GRACE_MS);
  }

  private cancelGrace(): void {
    if (this.graceTimer != null) {
      this.cancelTimer(this.graceTimer);
      this.graceTimer = null;
    }
    this.grindUntil = 0;
  }

  private clearGrind(): void {
    if (this.grindTimer != null) {
      this.cancelTimer(this.grindTimer);
      this.grindTimer = null;
    }
  }

  private now(): number {
    return this.wsTransport?.clock?.now() ?? Date.now();
  }

  private schedule(fn: () => void, ms: number): number {
    if (this.wsTransport?.clock) {
      return this.wsTransport.clock.schedule(fn, ms);
    }
    return setTimeout(fn, ms) as unknown as number;
  }

  private cancelTimer(id: number): void {
    if (this.wsTransport?.clock) {
      this.wsTransport.clock.cancel(id);
      return;
    }
    clearTimeout(id);
  }

  private emitStats(): void {
    const snap: MinerStats = { ...this.statsState };
    for (const cb of this.statsCbs) {
      cb(snap);
    }
  }

  private toast(message: string): void {
    const payload: MinerToast = { message, kind: 'error' };
    for (const cb of this.toastCbs) {
      cb(payload);
    }
  }
}
