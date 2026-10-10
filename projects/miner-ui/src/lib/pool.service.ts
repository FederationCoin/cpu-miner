import { Injectable, inject, signal } from '@angular/core';
import { HASHER_HOST } from './hasher-host';
import { tidesSatsField, type PoolStartOpts, type PoolStats } from './miner-api';

export const IDLE_POOL_STATS: PoolStats = {
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

@Injectable({ providedIn: 'root' })
export class PoolService {
  private readonly host = inject(HASHER_HOST);
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
    this.bound = true;
    this.unsub.push(
      this.host.onPoolStats((s) =>
        this.stats.set({
          ...IDLE_POOL_STATS,
          ...s,
          payouts: [...(s.payouts ?? [])],
          minerNet: tidesSatsField(s.minerNet),
          operatorFee: tidesSatsField(s.operatorFee),
          unfilledRemainder: tidesSatsField(s.unfilledRemainder),
        }),
      ),
    );
  }

  async start(opts: PoolStartOpts): Promise<string | null> {
    if (this.stats().running && this.host.inElectron) {
      await this.host.poolStop();
    }
    const r = await this.host.poolStart(opts);
    if (!r.ok) {
      return r.error ?? 'pool start failed';
    }
    return null;
  }

  async stop(): Promise<void> {
    await this.host.poolStop();
  }
}
