import { Injectable, signal } from '@angular/core';
import type { PoolStartOpts, PoolStats } from '../miner-api';

export const IDLE_POOL_STATS: PoolStats = {
  running: false,
  chain: null,
  height: 0,
  workers: 0,
  accepted: 0,
  rejected: 0,
  lastError: '',
  status: 'idle',
  stratumPort: 0,
  datumPort: 0,
};

@Injectable({ providedIn: 'root' })
export class PoolService {
  readonly stats = signal<PoolStats>(IDLE_POOL_STATS);
  private bound = false;
  private unsub: (() => void)[] = [];

  constructor() {
    this.bind();
  }

  bind(): void {
    if (this.bound) {
      return;
    }
    const api = window.miner;
    if (!api?.poolStart) {
      return;
    }
    this.bound = true;
    this.unsub.push(api.onPoolStats((s) => this.stats.set(s)));
  }

  async start(opts: PoolStartOpts): Promise<string | null> {
    const api = window.miner;
    if (!api?.poolStart) {
      return 'Open this app with npm start (Electron), not ng serve.';
    }
    if (this.stats().running) {
      await api.poolStop();
    }
    const r = await api.poolStart(opts);
    if (!r.ok) {
      return r.error ?? 'pool start failed';
    }
    return null;
  }

  async stop(): Promise<void> {
    await window.miner?.poolStop();
  }
}
