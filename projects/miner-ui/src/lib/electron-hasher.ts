import type { GpuScan, MinerInfo, MinerStartOpts, MinerStats, PoolStartOpts, PoolStats } from './miner-api';
import type { HasherHost } from './hasher-host';
import { bindDesktopWebGpu } from './webgpu-desktop';

export class ElectronHasherHost implements HasherHost {
  constructor() {
    if (window.miner) {
      bindDesktopWebGpu(window.miner);
    }
  }

  get canMine(): boolean {
    return !!window.miner;
  }

  get inElectron(): boolean {
    return !!window.miner;
  }

  async start(opts: MinerStartOpts): Promise<{ ok: boolean; error?: string }> {
    const api = window.miner;
    if (!api) {
      return { ok: false, error: 'Open this app with npm start (Electron), not ng serve.' };
    }
    return api.start(opts);
  }

  async stop(): Promise<void> {
    await window.miner?.stop();
  }

  info(): Promise<MinerInfo | null> {
    return window.miner?.info() ?? Promise.resolve(null);
  }

  async gpus(): Promise<GpuScan> {
    const empty: GpuScan = { devices: [], addon: false };
    try {
      return (await window.miner?.gpus()) ?? empty;
    } catch {
      return empty;
    }
  }

  pickDatadir(): Promise<string | null> {
    return window.miner?.pickDatadir() ?? Promise.resolve(null);
  }

  onStats(cb: (s: MinerStats) => void): () => void {
    return window.miner?.onStats(cb) ?? (() => undefined);
  }

  onToast(cb: (message: string) => void): () => void {
    return window.miner?.onToast(cb) ?? (() => undefined);
  }

  async poolStart(opts: PoolStartOpts): Promise<{ ok: boolean; error?: string }> {
    const api = window.miner;
    if (!api?.poolStart) {
      return { ok: false, error: 'Open this app with npm start (Electron), not ng serve.' };
    }
    return api.poolStart(opts);
  }

  async poolStop(): Promise<void> {
    await window.miner?.poolStop();
  }

  onPoolStats(cb: (s: PoolStats) => void): () => void {
    return window.miner?.onPoolStats(cb) ?? (() => undefined);
  }
}
