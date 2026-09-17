import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { PoolStartOpts } from '../miner-api';
import { CHAINS, type MinerChain } from './chain';
import { formatSats, mainIsNotLive } from './miner-format';
import { MiningService } from './mining.service';
import { IDLE_POOL_STATS, PoolService } from './pool.service';
import { RpcConnect, rpcConnectGroup, rpcConnectValue } from './rpc-connect';

@Component({
  selector: 'app-pool-pane',
  imports: [ReactiveFormsModule, RpcConnect],
  styleUrl: './miner-pane.css',
  templateUrl: './pool-pane.html',
})
export class PoolPane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly mining = inject(MiningService);
  protected readonly pool = inject(PoolService);
  protected readonly formError = signal('');

  protected readonly form = new FormGroup({
    rpc: rpcConnectGroup(35332),
    operator: new FormControl('', { nonNullable: true }),
    feePercent: new FormControl('2', { nonNullable: true }),
    stratumHost: new FormControl('127.0.0.1', { nonNullable: true }),
    stratumPort: new FormControl(23334, { nonNullable: true }),
    datumHost: new FormControl('127.0.0.1', { nonNullable: true }),
    datumPort: new FormControl(28916, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const inf = this.mining.info();
      if (!inf) {
        return;
      }
      if (!this.form.controls.rpc.controls.cookie.controls.datadir.value && !localStorage.getItem(this.key('datadir'))?.trim()) {
        this.form.controls.rpc.controls.cookie.patchValue({ datadir: inf.datadir }, { emitEvent: false });
      }
    });
  }

  ngOnInit(): void {
    const cfg = CHAINS[this.chain()];
    const authKind = localStorage.getItem(this.key('authKind'));
    this.form.patchValue({
      rpc: {
        host: localStorage.getItem(this.key('rpcHost'))?.trim() || '127.0.0.1',
        port: this.loadNum('rpcPort', cfg.rpcPort),
        authKind: authKind === 'userpass' ? 'userpass' : 'cookie',
        cookie: {
          datadir: localStorage.getItem(this.key('datadir'))?.trim() || this.mining.info()?.datadir || '',
        },
        userpass: {
          user: localStorage.getItem(this.key('rpcUser')) ?? '',
          password: localStorage.getItem(this.key('rpcPassword')) ?? '',
        },
      },
      operator: localStorage.getItem(this.key('operator')) ?? '',
      feePercent: localStorage.getItem(this.key('feePercent')) ?? '2',
      stratumHost: localStorage.getItem(this.key('stratumHost'))?.trim() || '127.0.0.1',
      stratumPort: this.loadNum('stratumPort', cfg.stratumPort),
      datumHost: localStorage.getItem(this.key('datumHost'))?.trim() || '127.0.0.1',
      datumPort: this.loadNum('datumPort', cfg.datumPort),
    });
    this.form.valueChanges.subscribe(() => this.persist());
  }

  protected id(suffix: string): string {
    return `${this.chain()}-pool-${suffix}`;
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

  protected startDisabled(): boolean {
    return !this.mining.inElectron() || this.pool.stats().running;
  }

  protected stopDisabled(): boolean {
    return !this.mining.inElectron() || !this.pool.stats().running || this.pool.stats().chain !== this.chain();
  }

  protected async start(): Promise<void> {
    this.formError.set('');
    const err = await this.pool.start(this.startOpts());
    if (err) {
      this.formError.set(err);
    }
  }

  protected async stop(): Promise<void> {
    await this.pool.stop();
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
    localStorage.setItem(this.key('rpcHost'), v.rpc.host);
    localStorage.setItem(this.key('rpcPort'), String(v.rpc.port));
    localStorage.setItem(this.key('authKind'), v.rpc.authKind);
    localStorage.setItem(this.key('datadir'), v.rpc.cookie.datadir);
    localStorage.setItem(this.key('rpcUser'), v.rpc.userpass.user);
    localStorage.setItem(this.key('rpcPassword'), v.rpc.userpass.password);
    localStorage.setItem(this.key('operator'), v.operator);
    localStorage.setItem(this.key('feePercent'), v.feePercent);
    localStorage.setItem(this.key('stratumHost'), v.stratumHost);
    localStorage.setItem(this.key('stratumPort'), String(v.stratumPort));
    localStorage.setItem(this.key('datumHost'), v.datumHost);
    localStorage.setItem(this.key('datumPort'), String(v.datumPort));
  }

  private startOpts(): PoolStartOpts {
    const v = this.form.getRawValue();
    const pct = Number.parseFloat(v.feePercent);
    const feeBps = Number.isFinite(pct) ? Math.round(pct * 100) : 200;
    return {
      chain: this.chain(),
      rpc: rpcConnectValue(this.form.controls.rpc),
      operator: v.operator,
      feeBps,
      stratumHost: v.stratumHost,
      stratumPort: v.stratumPort,
      datumHost: v.datumHost,
      datumPort: v.datumPort,
    };
  }
}
