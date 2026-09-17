import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { MineTo, MineToKind, MinerStartOpts, MinerStats } from '../miner-api';
import { CHAINS, type ChainConfig, type MinerChain } from './chain';
import { formatHashRate, gpuStatusHint, mainIsNotLive } from './miner-format';
import { IDLE_STATS, MiningService } from './mining.service';
import { PoolService } from './pool.service';
import { RpcConnect, rpcConnectGroup, rpcConnectValue } from './rpc-connect';

@Component({
  selector: 'app-miner-pane',
  imports: [ReactiveFormsModule, RpcConnect],
  styleUrl: './miner-pane.css',
  templateUrl: './miner-pane.html',
  host: { '[attr.data-chain]': 'chain()' },
})
export class MinerPane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly mining = inject(MiningService);
  protected readonly pool = inject(PoolService);

  protected readonly gpuIds = signal<string[]>([]);
  protected readonly gpuDetecting = signal(false);
  protected readonly formError = signal('');

  protected readonly form = new FormGroup({
    kind: new FormControl<MineToKind>('node', { nonNullable: true }),
    payout: new FormControl('', { nonNullable: true }),
    rpc: rpcConnectGroup(35332),
    stratum: new FormGroup({
      host: new FormControl('127.0.0.1', { nonNullable: true }),
      port: new FormControl(23334, { nonNullable: true }),
      worker: new FormControl('', { nonNullable: true }),
      password: new FormControl('x', { nonNullable: true }),
    }),
    datum: new FormGroup({
      host: new FormControl('127.0.0.1', { nonNullable: true }),
      port: new FormControl(28916, { nonNullable: true }),
      worker: new FormControl('', { nonNullable: true }),
      rpc: rpcConnectGroup(35332),
    }),
    appPoolStratum: new FormGroup({
      worker: new FormControl('', { nonNullable: true }),
      password: new FormControl('x', { nonNullable: true }),
    }),
    appPoolDatum: new FormGroup({
      worker: new FormControl('', { nonNullable: true }),
      rpc: rpcConnectGroup(35332),
    }),
    threads: new FormControl(4, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const inf = this.mining.info();
      if (!inf) {
        return;
      }
      this.patchEmptyDatadir('rpc.datadir', this.form.controls.rpc.controls.cookie, inf.datadir);
      this.patchEmptyDatadir('datum.rpc.datadir', this.form.controls.datum.controls.rpc.controls.cookie, inf.datadir);
      this.patchEmptyDatadir('appPoolDatum.rpc.datadir', this.form.controls.appPoolDatum.controls.rpc.controls.cookie, inf.datadir);
      if (!localStorage.getItem(this.key('threads')) && inf.defaultThreads > 0) {
        this.form.controls.threads.setValue(inf.defaultThreads, { emitEvent: false });
      }
    });
    effect(() => {
      const kind = this.form.controls.kind.value;
      if ((kind === 'appPoolStratum' || kind === 'appPoolDatum') && !this.appPoolReady()) {
        this.form.controls.kind.setValue('stratum');
      }
    });
  }

  ngOnInit(): void {
    const cfg = this.config();
    this.form.controls.rpc.patchValue(this.loadRpc('rpc', cfg.rpcPort));
    this.form.controls.stratum.patchValue({
      host: localStorage.getItem(this.key('stratum.host'))?.trim() || '127.0.0.1',
      port: this.loadNum('stratum.port', cfg.stratumPort),
      worker: localStorage.getItem(this.key('stratum.worker')) ?? '',
      password: localStorage.getItem(this.key('stratum.password')) ?? 'x',
    });
    this.form.controls.datum.patchValue({
      host: localStorage.getItem(this.key('datum.host'))?.trim() || '127.0.0.1',
      port: this.loadNum('datum.port', cfg.datumPort),
      worker: localStorage.getItem(this.key('datum.worker')) ?? '',
      rpc: this.loadRpc('datum.rpc', cfg.rpcPort),
    });
    this.form.controls.appPoolStratum.patchValue({
      worker: localStorage.getItem(this.key('appPoolStratum.worker')) ?? '',
      password: localStorage.getItem(this.key('appPoolStratum.password')) ?? 'x',
    });
    this.form.controls.appPoolDatum.patchValue({
      worker: localStorage.getItem(this.key('appPoolDatum.worker')) ?? '',
      rpc: this.loadRpc('appPoolDatum.rpc', cfg.rpcPort),
    });
    this.form.controls.payout.setValue(localStorage.getItem(this.key('payout')) ?? '');
    const savedThreads = localStorage.getItem(this.key('threads'));
    if (savedThreads) {
      this.form.controls.threads.setValue(Number.parseInt(savedThreads, 10) || 4);
    } else if ((this.mining.info()?.defaultThreads ?? 0) > 0) {
      this.form.controls.threads.setValue(this.mining.info()!.defaultThreads);
    }
    const savedKind = localStorage.getItem(this.key('kind')) as MineToKind | null;
    const allowed: MineToKind[] = ['node', 'stratum', 'datum', 'appPoolStratum', 'appPoolDatum'];
    this.form.controls.kind.setValue(savedKind && allowed.includes(savedKind) ? savedKind : 'node');
    this.gpuIds.set(this.loadGpuIds());
    this.form.valueChanges.subscribe(() => this.persist());
  }

  protected config(): ChainConfig {
    return CHAINS[this.chain()];
  }

  protected id(suffix: string): string {
    return `${this.chain()}-${suffix}`;
  }

  protected showMainWarning(): boolean {
    const cfg = this.config();
    return mainIsNotLive(cfg.id, cfg.mainIsLive);
  }

  protected otherMiningLabel(): string | null {
    const active = this.mining.activeChain();
    if (!active || active === this.chain()) {
      return null;
    }
    return CHAINS[active].label;
  }

  protected paneStats(): MinerStats {
    return this.mining.activeChain() === this.chain() ? this.mining.stats() : IDLE_STATS;
  }

  protected startDisabled(): boolean {
    return !this.mining.inElectron() || this.mining.activeChain() === this.chain();
  }

  protected stopDisabled(): boolean {
    return !this.mining.inElectron() || this.mining.activeChain() !== this.chain();
  }

  protected kindLocked(): boolean {
    return this.mining.activeChain() === this.chain();
  }

  protected appPoolReady(): boolean {
    const s = this.pool.stats();
    return s.running && s.chain === this.chain();
  }

  protected kind(): MineToKind {
    return this.form.controls.kind.value;
  }

  protected frozenStratum(): string {
    const s = this.pool.stats();
    const host = s.stratumHost === '0.0.0.0' || !s.stratumHost ? '127.0.0.1' : s.stratumHost;
    return `${host}:${s.stratumPort || this.config().stratumPort}`;
  }

  protected frozenDatum(): string {
    const s = this.pool.stats();
    const host = s.datumHost === '0.0.0.0' || !s.datumHost ? '127.0.0.1' : s.datumHost;
    return `${host}:${s.datumPort || this.config().datumPort}`;
  }

  protected async start(): Promise<void> {
    this.formError.set('');
    const err = await this.mining.start(this.startOpts());
    if (err) {
      this.formError.set(err);
    }
  }

  protected async stop(): Promise<void> {
    await this.mining.stop();
  }

  private startOpts(): MinerStartOpts {
    const chain = this.chain();
    const threads = this.form.controls.threads.value;
    const gpuIds = this.gpuIds();
    const mineTo = this.mineTo();
    return { chain, threads, gpuIds, mineTo };
  }

  private mineTo(): MineTo {
    const kind = this.kind();
    if (kind === 'node') {
      return { kind: 'node', rpc: rpcConnectValue(this.form.controls.rpc), payout: this.form.controls.payout.value };
    }
    if (kind === 'stratum') {
      return { kind: 'stratum', stratum: this.form.controls.stratum.getRawValue() };
    }
    if (kind === 'datum') {
      const d = this.form.controls.datum.getRawValue();
      return {
        kind: 'datum',
        datum: {
          host: d.host,
          port: d.port,
          worker: d.worker,
          rpc: rpcConnectValue(this.form.controls.datum.controls.rpc),
        },
      };
    }
    if (kind === 'appPoolStratum') {
      const v = this.form.controls.appPoolStratum.getRawValue();
      return { kind: 'appPoolStratum', worker: v.worker, password: v.password };
    }
    const v = this.form.controls.appPoolDatum.getRawValue();
    return {
      kind: 'appPoolDatum',
      worker: v.worker,
      rpc: rpcConnectValue(this.form.controls.appPoolDatum.controls.rpc),
    };
  }

  private persist(): void {
    const v = this.form.getRawValue();
    localStorage.setItem(this.key('kind'), v.kind);
    localStorage.setItem(this.key('payout'), v.payout);
    this.persistRpc('rpc', v.rpc);
    localStorage.setItem(this.key('stratum.host'), v.stratum.host);
    localStorage.setItem(this.key('stratum.port'), String(v.stratum.port));
    localStorage.setItem(this.key('stratum.worker'), v.stratum.worker);
    localStorage.setItem(this.key('stratum.password'), v.stratum.password);
    localStorage.setItem(this.key('datum.host'), v.datum.host);
    localStorage.setItem(this.key('datum.port'), String(v.datum.port));
    localStorage.setItem(this.key('datum.worker'), v.datum.worker);
    this.persistRpc('datum.rpc', v.datum.rpc);
    localStorage.setItem(this.key('appPoolStratum.worker'), v.appPoolStratum.worker);
    localStorage.setItem(this.key('appPoolStratum.password'), v.appPoolStratum.password);
    localStorage.setItem(this.key('appPoolDatum.worker'), v.appPoolDatum.worker);
    this.persistRpc('appPoolDatum.rpc', v.appPoolDatum.rpc);
    localStorage.setItem(this.key('threads'), String(v.threads));
  }

  private key(suffix: string): string {
    return `fc.${this.chain()}.${suffix}`;
  }

  private loadNum(suffix: string, fallback: number): number {
    const saved = localStorage.getItem(this.key(suffix));
    return saved ? Number.parseInt(saved, 10) || fallback : fallback;
  }

  private loadRpc(prefix: string, rpcPort: number) {
    const authKind = localStorage.getItem(this.key(`${prefix}.authKind`));
    return {
      host: localStorage.getItem(this.key(`${prefix}.host`))?.trim() || '127.0.0.1',
      port: this.loadNum(`${prefix}.port`, rpcPort),
      authKind: authKind === 'userpass' ? ('userpass' as const) : ('cookie' as const),
      cookie: {
        datadir: localStorage.getItem(this.key(`${prefix}.datadir`))?.trim() || this.mining.info()?.datadir || '',
      },
      userpass: {
        user: localStorage.getItem(this.key(`${prefix}.user`)) ?? '',
        password: localStorage.getItem(this.key(`${prefix}.password`)) ?? '',
      },
    };
  }

  private persistRpc(
    prefix: string,
    rpc: {
      host: string;
      port: number;
      authKind: string;
      cookie: { datadir: string };
      userpass: { user: string; password: string };
    },
  ): void {
    localStorage.setItem(this.key(`${prefix}.host`), rpc.host);
    localStorage.setItem(this.key(`${prefix}.port`), String(rpc.port));
    localStorage.setItem(this.key(`${prefix}.authKind`), rpc.authKind);
    localStorage.setItem(this.key(`${prefix}.datadir`), rpc.cookie.datadir);
    localStorage.setItem(this.key(`${prefix}.user`), rpc.userpass.user);
    localStorage.setItem(this.key(`${prefix}.password`), rpc.userpass.password);
  }

  private patchEmptyDatadir(suffix: string, group: FormGroup<{ datadir: FormControl<string> }>, datadir: string): void {
    if (!group.controls.datadir.value && !localStorage.getItem(this.key(suffix))?.trim()) {
      group.patchValue({ datadir }, { emitEvent: false });
    }
  }

  protected gpuList() {
    return this.mining.gpuDevices();
  }

  protected gpuDetectDisabled(): boolean {
    return !this.mining.inElectron() || this.kindLocked() || this.gpuDetecting();
  }

  protected gpuHint(): string {
    return gpuStatusHint({
      detecting: this.gpuDetecting(),
      scanned: this.mining.gpuScanned(),
      addon: this.mining.gpuAddon(),
      deviceCount: this.gpuList().length,
    });
  }

  protected async detectGpus(): Promise<void> {
    if (this.gpuDetectDisabled()) {
      return;
    }
    this.gpuDetecting.set(true);
    try {
      await this.mining.refreshGpus();
    } finally {
      this.gpuDetecting.set(false);
    }
  }

  protected gpuSelected(id: string): boolean {
    return this.gpuIds().includes(id);
  }

  protected gpuDomId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]+/g, '-');
  }

  protected toggleGpu(id: string, checked: boolean): void {
    const next = this.gpuIds().filter((x) => x !== id);
    if (checked) {
      next.push(id);
    }
    this.gpuIds.set(next);
    localStorage.setItem(this.key('gpuIds'), JSON.stringify(next));
  }

  private loadGpuIds(): string[] {
    const raw = localStorage.getItem(this.key('gpuIds'));
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      const known = new Set(this.mining.gpuDevices().map((d) => d.id));
      return parsed.filter((id): id is string => typeof id === 'string' && (!known.size || known.has(id)));
    } catch {
      return [];
    }
  }

  protected endpointHint(): string {
    const kind = this.kind();
    if (kind === 'node') {
      const rpc = rpcConnectValue(this.form.controls.rpc);
      return `${rpc.host}:${rpc.port} (node)`;
    }
    if (kind === 'stratum') {
      const s = this.form.controls.stratum.getRawValue();
      return `${s.host}:${s.port} (stratum)`;
    }
    if (kind === 'datum') {
      const d = this.form.controls.datum.getRawValue();
      return `${d.host}:${d.port} (datum) · ${d.rpc.host}:${d.rpc.port} (node)`;
    }
    if (kind === 'appPoolStratum') {
      return `${this.frozenStratum()} (app pool stratum)`;
    }
    const rpc = rpcConnectValue(this.form.controls.appPoolDatum.controls.rpc);
    return `${this.frozenDatum()} (app pool datum) · ${rpc.host}:${rpc.port} (node)`;
  }

  protected formatRate(n: number): string {
    return formatHashRate(n);
  }
}
