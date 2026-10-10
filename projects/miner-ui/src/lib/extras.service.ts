import { Injectable, inject, signal } from '@angular/core';
import { HASHER_HOST } from './hasher-host';
import type { ExtrasProbe } from './miner-api';

const NONE: ExtrasProbe = { node: false, gateway: false, pool: false };

@Injectable({ providedIn: 'root' })
export class ExtrasService {
  private readonly host = inject(HASHER_HOST);
  readonly probe = signal<ExtrasProbe>(NONE);
  readonly ready = signal(false);

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const next = this.host.extrasProbe ? await this.host.extrasProbe() : NONE;
    this.probe.set(next);
    this.ready.set(true);
  }
}
