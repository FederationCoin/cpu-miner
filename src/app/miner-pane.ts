import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { IDLE_STATS, MiningService } from './mining.service';
import { CHAINS, type ChainConfig, type MinerChain } from './chain';
import type { MinerMode, MinerStartOpts, MinerStats } from '../miner-api';

@Component({
  selector: 'app-miner-pane',
  styleUrl: './miner-pane.css',
  templateUrl: './miner-pane.html',
  host: { '[attr.data-chain]': 'chain()' },
})
export class MinerPane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly mining = inject(MiningService);

  protected readonly mode = signal<MinerMode>('rpc');
  protected readonly payout = signal('');
  protected readonly datadir = signal('');
  protected readonly host = signal('127.0.0.1');
  protected readonly port = signal(35332);
  protected readonly worker = signal('');
  protected readonly password = signal('x');
  protected readonly threads = signal(4);
  protected readonly gpuIds = signal<string[]>([]);
  protected readonly gpuDetecting = signal(false);
  protected readonly formError = signal('');

  constructor() {
    effect(() => {
      const inf = this.mining.info();
      if (!inf) {
        return;
      }
      if (!this.datadir() && !localStorage.getItem(this.key('datadir'))?.trim()) {
        this.datadir.set(inf.datadir);
      }
      if (!localStorage.getItem(this.key('threads')) && inf.defaultThreads > 0) {
        this.threads.set(inf.defaultThreads);
      }
    });
  }

  ngOnInit(): void {
    const savedMode = localStorage.getItem(this.key('mode'));
    this.mode.set(savedMode === 'stratum' ? 'stratum' : 'rpc');
    const savedDir = localStorage.getItem(this.key('datadir'))?.trim();
    this.datadir.set(savedDir || this.mining.info()?.datadir || '');
    this.host.set(localStorage.getItem(this.key('host'))?.trim() || '127.0.0.1');
    this.port.set(this.loadPort(this.mode()));
    this.worker.set(localStorage.getItem(this.key('worker')) ?? '');
    this.password.set(localStorage.getItem(this.key('password')) ?? 'x');
    this.payout.set(localStorage.getItem(this.key('payout')) ?? '');
    const savedThreads = localStorage.getItem(this.key('threads'));
    if (savedThreads) {
      this.threads.set(Number.parseInt(savedThreads, 10) || 4);
    } else {
      const n = this.mining.info()?.defaultThreads;
      if (n && n > 0) {
        this.threads.set(n);
      }
    }
    this.gpuIds.set(this.loadGpuIds());
  }

  protected config(): ChainConfig {
    return CHAINS[this.chain()];
  }

  protected id(suffix: string): string {
    return `${this.chain()}-${suffix}`;
  }

  protected showMainWarning(): boolean {
    const cfg = this.config();
    return cfg.id === 'main' && !cfg.mainIsLive;
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

  protected modeLocked(): boolean {
    return this.mining.activeChain() === this.chain();
  }

  protected defaultPort(mode: MinerMode = this.mode()): number {
    const cfg = this.config();
    return mode === 'stratum' ? cfg.stratumPort : cfg.rpcPort;
  }

  private key(suffix: string): string {
    return `fc.${this.chain()}.${suffix}`;
  }

  private portKey(mode: MinerMode): string {
    return this.key(mode === 'stratum' ? 'port.stratum' : 'port.rpc');
  }

  private loadPort(mode: MinerMode): number {
    const saved = localStorage.getItem(this.portKey(mode));
    return saved ? Number.parseInt(saved, 10) || this.defaultPort(mode) : this.defaultPort(mode);
  }

  protected setMode(mode: MinerMode): void {
    this.mode.set(mode);
    localStorage.setItem(this.key('mode'), mode);
    this.port.set(this.loadPort(mode));
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
    if (this.mode() === 'stratum') {
      return {
        chain,
        mode: 'stratum',
        threads: this.threads(),
        gpuIds: this.gpuIds(),
        host: this.host(),
        port: this.port(),
        worker: this.worker(),
        password: this.password(),
      };
    }
    return {
      chain,
      mode: 'rpc',
      threads: this.threads(),
      gpuIds: this.gpuIds(),
      host: this.host(),
      port: this.port(),
      payout: this.payout(),
      datadir: this.datadir(),
    };
  }

  protected setDatadir(value: string): void {
    this.datadir.set(value);
    localStorage.setItem(this.key('datadir'), value);
  }

  protected setHost(value: string): void {
    this.host.set(value);
    localStorage.setItem(this.key('host'), value);
  }

  protected setPort(value: string): void {
    const n = Number.parseInt(value, 10);
    this.port.set(n || this.defaultPort());
    localStorage.setItem(this.portKey(this.mode()), String(this.port()));
  }

  protected setWorker(value: string): void {
    this.worker.set(value);
    localStorage.setItem(this.key('worker'), value);
  }

  protected setPassword(value: string): void {
    this.password.set(value);
    localStorage.setItem(this.key('password'), value);
  }

  protected setPayout(value: string): void {
    this.payout.set(value);
    localStorage.setItem(this.key('payout'), value);
  }

  protected setThreads(value: string): void {
    const n = Number.parseInt(value, 10) || 1;
    this.threads.set(n);
    localStorage.setItem(this.key('threads'), String(n));
  }

  protected gpuList() {
    return this.mining.gpuDevices();
  }

  protected gpuDetectDisabled(): boolean {
    return !this.mining.inElectron() || this.modeLocked() || this.gpuDetecting();
  }

  protected gpuHint(): string {
    if (this.gpuDetecting()) {
      return 'Loading OpenCL. A bad driver can take down this app.';
    }
    if (!this.mining.gpuScanned()) {
      return 'No OpenCL GPUs listed yet. Detect loads the GPU driver in-process (a bad ICD can take down this app; skip this on WSL). CPU threads still mine.';
    }
    if (!this.mining.gpuAddon()) {
      return 'No GPU hasher in this build. CPU threads still mine.';
    }
    if (this.gpuList().length === 0) {
      return 'No OpenCL GPUs. Install NVIDIA, AMD, or Intel GPU drivers (not the CUDA Toolkit). CPU threads still mine.';
    }
    return 'Off until you tick a card. CPU workers stay on. Combined hashrate below. ccminer “blake2b” is the wrong PoW.';
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

  protected async browseDatadir(): Promise<void> {
    const p = await this.mining.pickDatadir();
    if (p) {
      this.setDatadir(p);
    }
  }

  protected cookieHint(): string {
    const d = this.datadir().trim().replace(/[/\\]+$/, '');
    const cfg = this.config();
    if (cfg.id === 'main') {
      return d ? `${d}/.cookie` : '';
    }
    if (!d) {
      return '';
    }
    if (d.endsWith('testnet3')) {
      return `${d}/.cookie`;
    }
    return `${d}/testnet3/.cookie`;
  }

  protected endpointHint(): string {
    return `${this.host()}:${this.port()} (${this.mode() === 'stratum' ? 'stratum' : 'rpc'})`;
  }

  protected formatRate(n: number): string {
    if (n >= 1e6) {
      return `${(n / 1e6).toFixed(2)} MH/s`;
    }
    if (n >= 1e3) {
      return `${(n / 1e3).toFixed(2)} kH/s`;
    }
    return `${n.toFixed(0)} H/s`;
  }
}
