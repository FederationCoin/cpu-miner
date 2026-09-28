import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import type { PoolStartOpts } from './miner-api';
import { CHAINS, type MinerChain } from './chain';
import { formatSats, mainIsNotLive } from './miner-format';
import { MINER_SHELL } from './miner-shell';
import { MiningService } from './mining.service';
import { IDLE_POOL_STATS, PoolService } from './pool.service';
import { RpcConnect, rpcConnectGroup, rpcConnectValue, type RpcConnectForm } from './rpc-connect';
import { DefaultsFold } from './defaults-fold';
import { ListenReachField, listenBindAddr, listenLabel, type ListenReach } from './listen-reach';

@Component({
  selector: 'app-pool-pane',
  imports: [ReactiveFormsModule, RpcConnect, DefaultsFold, MatButtonModule, ListenReachField],
  styleUrl: './miner-pane.css',
  templateUrl: './pool-pane.html',
})
export class PoolPane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly mining = inject(MiningService);
  protected readonly pool = inject(PoolService);
  protected readonly shell = inject(MINER_SHELL);
  protected readonly formError = signal('');
  protected readonly phase = signal<'idle' | 'starting' | 'stopping'>('idle');

  protected readonly form = new FormGroup({
    rpc: new FormArray<RpcConnectForm>([rpcConnectGroup(35332)]),
    operator: new FormControl('', { nonNullable: true }),
    feePercent: new FormControl('2', { nonNullable: true }),
    stratumReach: new FormControl<ListenReach>('computer', { nonNullable: true }),
    stratumPort: new FormControl(23334, { nonNullable: true }),
    datumReach: new FormControl<ListenReach>('computer', { nonNullable: true }),
    datumPort: new FormControl(28916, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const running = this.pool.stats().running && this.pool.stats().chain === this.chain();
      const opts = { emitEvent: false } as const;
      if (running) {
        this.form.controls.stratumReach.disable(opts);
        this.form.controls.datumReach.disable(opts);
      } else if (this.form.controls.stratumReach.disabled) {
        this.form.controls.stratumReach.enable(opts);
        this.form.controls.datumReach.enable(opts);
      }
      const inf = this.mining.info();
      if (!inf) {
        return;
      }
      for (const g of this.form.controls.rpc.controls) {
        if (!g.controls.cookie.controls.datadir.value && !localStorage.getItem(this.key('datadir'))?.trim()) {
          g.controls.cookie.patchValue({ datadir: inf.datadir }, { emitEvent: false });
        }
      }
    });
  }

  ngOnInit(): void {
    if (this.shell.kind !== 'desktop') {
      return;
    }
    const d = this.shell.defaults.chains[this.chain()];
    this.replaceRpcRows(this.savedRpcRows(d.rpc.host, d.rpc.port));
    this.form.patchValue({
      operator: localStorage.getItem(this.key('operator')) ?? '',
      feePercent: localStorage.getItem(this.key('feePercent')) ?? d.pool.feePercent,
      stratumReach: this.savedReach('stratum', d.pool.stratumHost),
      stratumPort: this.loadNum('stratumPort', d.pool.stratumPort),
      datumReach: this.savedReach('datum', d.pool.datumHost),
      datumPort: this.loadNum('datumPort', d.pool.datumPort),
    });
    this.form.valueChanges.subscribe(() => this.persist());
  }

  protected id(suffix: string): string {
    return `${this.chain()}-pool-${suffix}`;
  }

  protected rpcIdPrefix(index: number): string {
    return index === 0 ? `${this.chain()}-pool` : `${this.chain()}-pool-${index}`;
  }

  protected addRpc(): void {
    const last = this.form.controls.rpc.at(this.form.controls.rpc.length - 1);
    const next = rpcConnectGroup(last.controls.port.value);
    next.patchValue(last.getRawValue());
    this.form.controls.rpc.push(next);
  }

  protected removeRpc(index: number): void {
    if (this.form.controls.rpc.length < 2) {
      return;
    }
    this.form.controls.rpc.removeAt(index);
  }

  protected foldSingleRpc(): boolean {
    return this.form.controls.rpc.length === 1 && this.rpcCookie(this.form.controls.rpc.at(0));
  }

  protected config() {
    return CHAINS[this.chain()];
  }

  protected showMainWarning(): boolean {
    return mainIsNotLive(this.chain(), this.config().mainIsLive);
  }

  protected paneStats() {
    const s = this.pool.stats();
    return s.running && s.chain === this.chain() ? s : IDLE_POOL_STATS;
  }

  protected tidesJson(): string {
    return JSON.stringify(this.paneStats().payouts ?? []);
  }

  protected formatPayout(sats: string): string {
    return formatSats(sats);
  }

  protected startLabel(): string {
    return this.phase() === 'starting' ? 'Starting' : 'Start';
  }

  protected stopLabel(): string {
    return this.phase() === 'stopping' ? 'Stopping' : 'Stop';
  }

  protected startDisabled(): boolean {
    return this.phase() !== 'idle' || !this.mining.inElectron() || this.pool.stats().running;
  }

  protected stopDisabled(): boolean {
    return (
      this.phase() !== 'idle' ||
      !this.mining.inElectron() ||
      !this.pool.stats().running ||
      this.pool.stats().chain !== this.chain()
    );
  }

  protected async start(): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    this.formError.set('');
    this.phase.set('starting');
    try {
      const err = await this.pool.start(this.startOpts());
      if (err) {
        this.formError.set(err);
        this.mining.warn(err);
      }
    } finally {
      this.phase.set('idle');
    }
  }

  protected async stop(): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    this.phase.set('stopping');
    try {
      await this.pool.stop();
    } finally {
      this.phase.set('idle');
    }
  }

  private key(suffix: string): string {
    return `fc.${this.chain()}.pool.${suffix}`;
  }

  private loadNum(suffix: string, fallback: number): number {
    const saved = localStorage.getItem(this.key(suffix));
    return saved ? Number.parseInt(saved, 10) || fallback : fallback;
  }

  private persist(): void {
    const v = this.form.getRawValue();
    localStorage.setItem(this.key('rpcList'), JSON.stringify(v.rpc));
    localStorage.setItem(this.key('operator'), v.operator);
    localStorage.setItem(this.key('feePercent'), v.feePercent);
    localStorage.setItem(this.key('stratumReach'), v.stratumReach);
    localStorage.setItem(this.key('stratumPort'), String(v.stratumPort));
    localStorage.setItem(this.key('datumReach'), v.datumReach);
    localStorage.setItem(this.key('datumPort'), String(v.datumPort));
  }

  private startOpts(): PoolStartOpts {
    const v = this.form.getRawValue();
    const pct = Number.parseFloat(v.feePercent);
    const feeBps = Number.isFinite(pct) ? Math.round(pct * 100) : 200;
    return {
      chain: this.chain(),
      rpc: this.form.controls.rpc.controls.map((g) => rpcConnectValue(g)),
      operator: v.operator,
      feeBps,
      stratumHost: listenBindAddr(v.stratumReach),
      stratumPort: v.stratumPort,
      datumHost: listenBindAddr(v.datumReach),
      datumPort: v.datumPort,
    };
  }

  protected rpcCookie(form: RpcConnectForm): boolean {
    return form.controls.authKind.value === 'cookie';
  }

  protected rpcSummary(form: RpcConnectForm): string {
    const v = form.getRawValue();
    return `${v.host}:${v.port}`;
  }

  protected bindSummary(reach: ListenReach, port: number): string {
    return `${listenLabel(reach)} · ${port}`;
  }

  private savedReach(name: 'stratum' | 'datum', defaultHost: string): ListenReach {
    const saved = localStorage.getItem(this.key(`${name}Reach`));
    if (saved === 'network' || saved === 'computer') {
      return saved;
    }
    const host = localStorage.getItem(this.key(`${name}Host`))?.trim() || defaultHost;
    return host === '0.0.0.0' ? 'network' : 'computer';
  }

  private savedRpcRows(defaultHost: string, defaultPort: number): Record<string, unknown>[] {
    const raw = localStorage.getItem(this.key('rpcList'));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as Record<string, unknown>[];
        }
      } catch {
        /* migrate from the single-node keys below */
      }
    }
    const authKind = localStorage.getItem(this.key('authKind'));
    return [
      {
        host: localStorage.getItem(this.key('rpcHost'))?.trim() || defaultHost,
        port: this.loadNum('rpcPort', defaultPort),
        authKind: authKind === 'userpass' ? 'userpass' : 'cookie',
        cookie: {
          datadir: localStorage.getItem(this.key('datadir'))?.trim() || this.mining.info()?.datadir || '',
        },
        userpass: {
          user: localStorage.getItem(this.key('rpcUser')) ?? '',
          password: localStorage.getItem(this.key('rpcPassword')) ?? '',
        },
      },
    ];
  }

  private replaceRpcRows(rows: Record<string, unknown>[]): void {
    const arr = this.form.controls.rpc;
    arr.clear();
    for (const row of rows) {
      const g = rpcConnectGroup(35332);
      g.patchValue(row);
      arr.push(g);
    }
  }
}
