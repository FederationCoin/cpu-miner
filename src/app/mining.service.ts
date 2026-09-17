import { Injectable, signal } from '@angular/core';
import type { GpuDevice, GpuScan, MinerChain, MinerInfo, MinerStartOpts, MinerStats, MineToKind } from '../miner-api';

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
};

/** Sole window.miner client. One hasher session; panes only hold form state. */
@Injectable({ providedIn: 'root' })
export class MiningService {
  readonly inElectron = signal(false);
  readonly info = signal<MinerInfo | null>(null);
  readonly stats = signal<MinerStats>(IDLE_STATS);
  readonly gpuDevices = signal<GpuDevice[]>([]);
  readonly gpuAddon = signal(false);
  readonly gpuScanned = signal(false);
  readonly toast = signal('');
  readonly sessionKind = signal<MineToKind | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void)[] = [];
  private bound = false;

  constructor() {
    this.bind();
  }

  /** Subscribe once. Tests that set window.miner after construct call this again. */
  bind(): void {
    if (this.bound) {
      return;
    }
    const api = window.miner;
    this.inElectron.set(!!api);
    if (!api) {
      return;
    }
    this.bound = true;
    void api.info().then((i) => this.info.set(i));
    this.unsub.push(
      api.onStats((s) => {
        this.stats.set(s);
        if (!s.running) {
          this.sessionKind.set(null);
        }
      }),
    );
    this.unsub.push(
      api.onToast((message) => {
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
    const api = window.miner;
    if (!api) {
      return 'Open this app with npm start (Electron), not ng serve.';
    }
    if (this.stats().running) {
      await api.stop();
    }
    const r = await api.start(opts);
    if (!r.ok) {
      return r.error ?? 'start failed';
    }
    this.sessionKind.set(opts.mineTo.kind);
    return null;
  }

  async stop(): Promise<void> {
    await window.miner?.stop();
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
    const empty: GpuScan = { devices: [], addon: false };
    const api = window.miner;
    if (!api) {
      this.gpuDevices.set([]);
      this.gpuAddon.set(false);
      this.gpuScanned.set(true);
      return empty;
    }
    try {
      const r = await api.gpus();
      this.gpuDevices.set(r.devices);
      this.gpuAddon.set(r.addon);
      this.gpuScanned.set(true);
      return r;
    } catch {
      this.gpuDevices.set([]);
      this.gpuAddon.set(false);
      this.gpuScanned.set(true);
      return empty;
    }
  }

  pickDatadir(): Promise<string | null> {
    return window.miner?.pickDatadir() ?? Promise.resolve(null);
  }
}
