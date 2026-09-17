import { Injectable, inject, signal } from '@angular/core';
import { HASHER_HOST } from './hasher-host';
import type { GpuDevice, GpuScan, GpuScanReason, MinerChain, MinerInfo, MinerStartOpts, MinerStats, MineToKind } from './miner-api';

export const IDLE_STATS: MinerStats = {
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

/** One hasher session; panes only hold form state. */
@Injectable({ providedIn: 'root' })
export class MiningService {
  private readonly host = inject(HASHER_HOST);
  readonly inElectron = signal(false);
  readonly canMine = signal(false);
  readonly info = signal<MinerInfo | null>(null);
  readonly stats = signal<MinerStats>(IDLE_STATS);
  readonly gpuDevices = signal<GpuDevice[]>([]);
  readonly gpuAddon = signal(false);
  readonly gpuScanned = signal(false);
  readonly gpuReason = signal<GpuScanReason | undefined>(undefined);
  readonly toast = signal('');
  readonly sessionKind = signal<MineToKind | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void)[] = [];
  private bound = false;

  constructor() {
    this.bind();
  }

  bind(): void {
    if (this.bound) {
      return;
    }
    this.inElectron.set(this.host.inElectron);
    this.canMine.set(this.host.canMine);
    this.bound = true;
    void this.host.info().then((i) => this.info.set(i));
    this.unsub.push(
      this.host.onStats((s) => {
        this.stats.set({ ...s });
        if (!s.running) {
          this.sessionKind.set(null);
        }
      }),
    );
    this.unsub.push(
      this.host.onToast((message) => {
        this.toast.set(message);
        if (this.toastTimer) {
          clearTimeout(this.toastTimer);
        }
        this.toastTimer = setTimeout(() => this.toast.set(''), 5000);
      }),
    );
  }

  activeChain(): MinerChain | null {
    const s = this.stats();
    return s.running ? s.chain : null;
  }

  async start(opts: MinerStartOpts): Promise<string | null> {
    if (!this.host.canMine) {
      return 'Open this app with npm start (Electron), not ng serve.';
    }
    if (this.stats().running) {
      await this.host.stop();
    }
    const r = await this.host.start(opts);
    if (!r.ok) {
      return r.error ?? 'start failed';
    }
    this.sessionKind.set(opts.mineTo.kind);
    return null;
  }

  async stop(): Promise<void> {
    await this.host.stop();
    this.sessionKind.set(null);
  }

  warn(message: string): void {
    this.toast.set(message);
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => this.toast.set(''), 5000);
  }

  async refreshGpus(): Promise<GpuScan> {
    const empty: GpuScan = { devices: [], addon: false, reason: 'error' };
    try {
      const r = await this.host.gpus();
      this.gpuDevices.set(r.devices);
      this.gpuAddon.set(r.addon);
      this.gpuReason.set(r.reason);
      this.gpuScanned.set(true);
      return r;
    } catch {
      this.gpuDevices.set([]);
      this.gpuAddon.set(false);
      this.gpuReason.set('error');
      this.gpuScanned.set(true);
      return empty;
    }
  }

  pickDatadir(): Promise<string | null> {
    return this.host.pickDatadir();
  }
}
