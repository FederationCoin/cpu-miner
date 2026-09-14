import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { CHAINS, type MinerChain } from './chain';
import { cookiePathHint, mainIsNotLive } from './miner-format';
import { MiningService } from './mining.service';
import { IDLE_POOL_STATS, PoolService } from './pool.service';
import type { PoolStartOpts } from '../miner-api';

@Component({
  selector: 'app-pool-pane',
  styleUrl: './miner-pane.css',
  templateUrl: './pool-pane.html',
})
export class PoolPane implements OnInit {
  protected readonly mining = inject(MiningService);
  protected readonly pool = inject(PoolService);

  protected readonly chain = signal<MinerChain>('testnet');
  protected readonly rpcHost = signal('127.0.0.1');
  protected readonly rpcPort = signal(35332);
  protected readonly datadir = signal('');
  protected readonly operator = signal('');
  protected readonly feePercent = signal('2');
  protected readonly stratumHost = signal('127.0.0.1');
  protected readonly stratumPort = signal(23334);
  protected readonly datumHost = signal('127.0.0.1');
  protected readonly datumPort = signal(28916);
  protected readonly formError = signal('');

  constructor() {
    effect(() => {
      const inf = this.mining.info();
      if (!inf) {
        return;
      }
      if (!this.datadir() && !localStorage.getItem('fc.pool.datadir')?.trim()) {
        this.datadir.set(inf.datadir);
      }
    });
  }

  ngOnInit(): void {
    const savedChain = localStorage.getItem('fc.pool.chain');
    this.chain.set(savedChain === 'main' ? 'main' : 'testnet');
    this.rpcHost.set(localStorage.getItem('fc.pool.rpcHost')?.trim() || '127.0.0.1');
    this.datadir.set(localStorage.getItem('fc.pool.datadir')?.trim() || this.mining.info()?.datadir || '');
    this.operator.set(localStorage.getItem('fc.pool.operator') ?? '');
    this.feePercent.set(localStorage.getItem('fc.pool.feePercent') ?? '2');
    this.stratumHost.set(localStorage.getItem('fc.pool.stratumHost')?.trim() || '127.0.0.1');
    this.datumHost.set(localStorage.getItem('fc.pool.datumHost')?.trim() || '127.0.0.1');
    this.rpcPort.set(this.loadNum('fc.pool.rpcPort', this.config().rpcPort));
    this.stratumPort.set(this.loadNum('fc.pool.stratumPort', 23334));
    this.datumPort.set(this.loadNum('fc.pool.datumPort', 28916));
  }

  protected config() {
    return CHAINS[this.chain()];
  }

  protected showMainWarning(): boolean {
    return mainIsNotLive(this.chain(), this.config().mainIsLive);
  }

  protected paneStats() {
    return this.pool.stats().running ? this.pool.stats() : IDLE_POOL_STATS;
  }

  protected startDisabled(): boolean {
    return !this.mining.inElectron() || this.pool.stats().running;
  }

  protected stopDisabled(): boolean {
    return !this.mining.inElectron() || !this.pool.stats().running;
  }

  protected cookieHint(): string {
    return cookiePathHint(this.datadir(), this.chain());
  }

  protected setChain(id: MinerChain): void {
    this.chain.set(id);
    localStorage.setItem('fc.pool.chain', id);
    const saved = localStorage.getItem('fc.pool.rpcPort');
    if (!saved) {
      this.rpcPort.set(CHAINS[id].rpcPort);
    }
  }

  protected setRpcHost(value: string): void {
    this.rpcHost.set(value);
    localStorage.setItem('fc.pool.rpcHost', value);
  }

  protected setRpcPort(value: string): void {
    const n = Number.parseInt(value, 10) || this.config().rpcPort;
    this.rpcPort.set(n);
    localStorage.setItem('fc.pool.rpcPort', String(n));
  }

  protected setDatadir(value: string): void {
    this.datadir.set(value);
    localStorage.setItem('fc.pool.datadir', value);
  }

  protected setOperator(value: string): void {
    this.operator.set(value);
    localStorage.setItem('fc.pool.operator', value);
  }

  protected setFeePercent(value: string): void {
    this.feePercent.set(value);
    localStorage.setItem('fc.pool.feePercent', value);
  }

  protected setStratumHost(value: string): void {
    this.stratumHost.set(value);
    localStorage.setItem('fc.pool.stratumHost', value);
  }

  protected setStratumPort(value: string): void {
    const n = Number.parseInt(value, 10) || 23334;
    this.stratumPort.set(n);
    localStorage.setItem('fc.pool.stratumPort', String(n));
  }

  protected setDatumHost(value: string): void {
    this.datumHost.set(value);
    localStorage.setItem('fc.pool.datumHost', value);
  }

  protected setDatumPort(value: string): void {
    const n = Number.parseInt(value, 10) || 28916;
    this.datumPort.set(n);
    localStorage.setItem('fc.pool.datumPort', String(n));
  }

  protected async browseDatadir(): Promise<void> {
    const p = await this.mining.pickDatadir();
    if (p) {
      this.setDatadir(p);
    }
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

  private loadNum(key: string, fallback: number): number {
    const saved = localStorage.getItem(key);
    return saved ? Number.parseInt(saved, 10) || fallback : fallback;
  }

  private startOpts(): PoolStartOpts {
    const pct = Number.parseFloat(this.feePercent());
    const feeBps = Number.isFinite(pct) ? Math.round(pct * 100) : 200;
    return {
      chain: this.chain(),
      rpcHost: this.rpcHost(),
      rpcPort: this.rpcPort(),
      datadir: this.datadir(),
      operator: this.operator(),
      feeBps,
      stratumHost: this.stratumHost(),
      stratumPort: this.stratumPort(),
      datumHost: this.datumHost(),
      datumPort: this.datumPort(),
    };
  }
}
