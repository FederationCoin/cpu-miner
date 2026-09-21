import { Component, OnInit, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { CHAINS, type MinerChain } from './chain';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import { mainIsNotLive } from './miner-format';
import { AddonMissingCard } from './addon-missing-card';
import { NodeDownloadCta } from './node-download-cta';
import { ExtrasService } from './extras.service';
import type { NodeStatusView } from './miner-api';

@Component({
  selector: 'app-node-pane',
  imports: [MatButtonModule, MatCardModule, AddonMissingCard, NodeDownloadCta],
  templateUrl: './node-pane.html',
  host: { '[attr.data-chain]': 'chain()' },
})
export class NodePane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  protected readonly extras = inject(ExtrasService);
  private readonly host = inject(HASHER_HOST);
  protected readonly status = signal<NodeStatusView>({
    session: 'idle',
    chain: null,
    height: 0,
    running: false,
    lastError: '',
  });
  protected readonly error = signal('');

  ngOnInit(): void {
    void this.refresh();
  }

  protected isWeb(): boolean {
    return this.shell.kind === 'webDemo';
  }

  protected extraPresent(): boolean {
    return this.extras.probe().node;
  }

  protected showMainWarning(): boolean {
    return mainIsNotLive(this.chain(), CHAINS[this.chain()].mainIsLive);
  }

  protected showStop(): boolean {
    return this.status().session === 'spawned';
  }

  protected async refresh(): Promise<void> {
    if (!this.host.nodeStatus) {
      return;
    }
    this.status.set(await this.host.nodeStatus(this.chain()));
  }

  protected async start(): Promise<void> {
    this.error.set('');
    if (!this.host.nodeStart) {
      this.error.set('Node start is desktop only.');
      return;
    }
    const r = await this.host.nodeStart(this.chain());
    if (!r.ok) {
      this.error.set(r.error ?? 'start failed');
    }
    await this.refresh();
  }

  protected async stop(): Promise<void> {
    this.error.set('');
    const r = await this.host.nodeStop?.();
    if (r && !r.ok) {
      this.error.set(r.error ?? 'stop failed');
    }
    await this.refresh();
  }
}
