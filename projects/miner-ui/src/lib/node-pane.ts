import { Component, DestroyRef, OnInit, inject, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { CHAINS, type MinerChain } from './chain';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import { mainIsNotLive } from './miner-format';
import { AddonMissingCard } from './addon-missing-card';
import { NodeDownloadCta } from './node-download-cta';
import { ExtrasService } from './extras.service';
import { ProcessCard } from './process-card';
import { EMPTY_NODE_STATUS, type NodeStatusView } from './miner-api';

const POLL_MS = 3000;

@Component({
  selector: 'app-node-pane',
  imports: [ReactiveFormsModule, MatCardModule, AddonMissingCard, NodeDownloadCta, ProcessCard],
  templateUrl: './node-pane.html',
  host: { '[attr.data-chain]': 'chain()' },
})
export class NodePane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  protected readonly extras = inject(ExtrasService);
  private readonly host = inject(HASHER_HOST);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly status = signal<NodeStatusView>(EMPTY_NODE_STATUS);
  protected readonly error = signal('');
  protected readonly datadir = new FormControl('', { nonNullable: true });

  ngOnInit(): void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
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

  protected showStart(): boolean {
    return this.status().session === 'idle' && !this.showMainWarning();
  }

  protected showStop(): boolean {
    return this.status().session === 'spawned';
  }

  protected async refresh(): Promise<void> {
    if (!this.host.nodeStatus) {
      return;
    }
    const next = { ...EMPTY_NODE_STATUS, ...(await this.host.nodeStatus({ chain: this.chain(), datadir: this.datadir.value })) };
    this.status.set(next);
    if (next.session !== 'idle') {
      this.datadir.setValue(next.datadir, { emitEvent: false });
      this.datadir.disable({ emitEvent: false });
      return;
    }
    this.datadir.enable({ emitEvent: false });
    if (!this.datadir.dirty && next.datadir) {
      this.datadir.setValue(next.datadir, { emitEvent: false });
    }
  }

  protected async start(): Promise<void> {
    this.error.set('');
    if (!this.host.nodeStart) {
      this.error.set('Node start is desktop only.');
      return;
    }
    const r = await this.host.nodeStart({ chain: this.chain(), datadir: this.datadir.value.trim() });
    if (!r.ok) {
      this.error.set(r.error ?? 'start failed');
    }
    this.datadir.markAsPristine();
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

  protected async browse(): Promise<void> {
    const picked = await this.host.pickDatadir();
    if (picked) {
      this.datadir.setValue(picked);
      this.datadir.markAsDirty();
    }
  }

  protected onPath(value: string): void {
    this.datadir.setValue(value);
    this.datadir.markAsDirty();
  }
}
