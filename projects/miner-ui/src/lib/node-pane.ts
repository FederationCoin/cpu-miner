import { Component, DestroyRef, OnInit, inject, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { CHAINS, type MinerChain } from './chain';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import { mainIsNotLive } from './miner-format';
import { AddonMissingCard } from './addon-missing-card';
import { NodeDownloadCta } from './node-download-cta';
import { ExtrasService } from './extras.service';
import { ListenReachField, type ListenReach } from './listen-reach';
import { ProcessCard } from './process-card';
import { EMPTY_NODE_STATUS, type NodeStatusView } from './miner-api';

const POLL_MS = 3000;

@Component({
  selector: 'app-node-pane',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatSlideToggleModule,
    AddonMissingCard,
    NodeDownloadCta,
    ProcessCard,
    ListenReachField,
  ],
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
  protected readonly listenReach = new FormControl<ListenReach>('computer', { nonNullable: true });
  protected readonly rpc = new FormControl(true, { nonNullable: true });
  protected readonly phase = signal<'idle' | 'starting' | 'stopping'>('idle');

  ngOnInit(): void {
    const savedDir = localStorage.getItem(this.datadirKey());
    if (savedDir) {
      this.datadir.setValue(savedDir);
    }
    const saved = localStorage.getItem(this.listenKey());
    if (saved === 'network' || saved === 'computer') {
      this.listenReach.setValue(saved);
    }
    if (localStorage.getItem(this.rpcKey()) === '0') {
      this.rpc.setValue(false);
    }
    this.datadir.valueChanges.subscribe((value) => localStorage.setItem(this.datadirKey(), value));
    this.listenReach.valueChanges.subscribe((value) => localStorage.setItem(this.listenKey(), value));
    this.rpc.valueChanges.subscribe((value) => localStorage.setItem(this.rpcKey(), value ? '1' : '0'));
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
    if (this.showMainWarning() || this.phase() === 'stopping') {
      return false;
    }
    if (this.phase() === 'starting') {
      return true;
    }
    return this.status().session === 'idle';
  }

  protected showKill(): boolean {
    return this.status().portTaken !== '' || this.status().otherCount > 0 || this.status().foreignPids.length > 0;
  }

  protected showStop(): boolean {
    if (this.phase() === 'starting') {
      return false;
    }
    return this.phase() === 'stopping' || this.status().session === 'spawned';
  }

  protected startLabel(): string {
    return this.phase() === 'starting' ? 'Starting' : 'Start';
  }

  protected stopLabel(): string {
    return this.phase() === 'stopping' ? 'Stopping' : 'Stop';
  }

  protected async refresh(): Promise<void> {
    if (!this.host.nodeStatus) {
      return;
    }
    const next = {
      ...EMPTY_NODE_STATUS,
      ...(await this.host.nodeStatus({
        chain: this.chain(),
        datadir: this.datadir.value,
        listenReach: this.listenReach.getRawValue(),
        rpc: this.rpc.getRawValue(),
      })),
    };
    this.status.set(next);
    if (next.session !== 'idle' || this.phase() !== 'idle') {
      this.datadir.setValue(next.datadir, { emitEvent: false });
      this.datadir.disable({ emitEvent: false });
      this.listenReach.disable({ emitEvent: false });
      this.rpc.disable({ emitEvent: false });
      return;
    }
    this.datadir.enable({ emitEvent: false });
    if (this.listenReach.disabled) {
      this.listenReach.enable({ emitEvent: false });
    }
    if (this.rpc.disabled) {
      this.rpc.enable({ emitEvent: false });
    }
    if (!this.datadir.dirty && !localStorage.getItem(this.datadirKey()) && next.datadir) {
      this.datadir.setValue(next.datadir, { emitEvent: false });
    }
  }

  protected async start(): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    this.error.set('');
    this.phase.set('starting');
    try {
      if (!this.host.nodeStart) {
        this.error.set('Node start is desktop only.');
        return;
      }
      const r = await this.host.nodeStart({
        chain: this.chain(),
        datadir: this.datadir.value.trim(),
        listenReach: this.listenReach.getRawValue(),
        rpc: this.rpc.getRawValue(),
      });
      if (!r.ok) {
        this.error.set(r.error ?? 'start failed');
      }
      this.datadir.markAsPristine();
    } finally {
      await this.refresh();
      this.phase.set('idle');
    }
  }

  protected async stop(): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    this.error.set('');
    this.phase.set('stopping');
    try {
      const r = await this.host.nodeStop?.();
      if (r && !r.ok) {
        this.error.set(r.error ?? 'stop failed');
      }
    } finally {
      await this.refresh();
      this.phase.set('idle');
    }
  }

  protected async browse(): Promise<void> {
    const picked = await this.host.pickDatadir();
    if (picked) {
      this.datadir.setValue(picked);
      this.datadir.markAsDirty();
    }
  }

  protected async kill(pid: number): Promise<void> {
    this.error.set('');
    const r = await this.host.nodeKillForeign?.(pid);
    if (r && !r.ok) {
      this.error.set(r.error ?? 'kill failed');
    }
    await this.refresh();
  }

  private datadirKey(): string {
    return `fc.${this.chain()}.node.datadir`;
  }

  private listenKey(): string {
    return `fc.${this.chain()}.node.listen`;
  }

  private rpcKey(): string {
    return `fc.${this.chain()}.node.rpc`;
  }

  protected onPath(value: string): void {
    this.datadir.setValue(value);
    this.datadir.markAsDirty();
  }
}
