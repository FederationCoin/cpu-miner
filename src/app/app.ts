import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import type { MinerInfo, MinerMode, MinerStats } from '../miner-api';

@Component({
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnInit, OnDestroy {
  private static readonly modeKey = 'fc.mode';
  private static readonly datadirKey = 'fc.datadir';
  private static readonly hostKey = 'fc.host';
  private static readonly portRpcKey = 'fc.port.rpc';
  private static readonly portStratumKey = 'fc.port.stratum';
  private static readonly workerKey = 'fc.worker';
  private static readonly passwordKey = 'fc.password';

  protected readonly mode = signal<MinerMode>('rpc');
  protected readonly payout = signal('');
  protected readonly datadir = signal('');
  protected readonly host = signal('127.0.0.1');
  protected readonly port = signal(35332);
  protected readonly worker = signal('');
  protected readonly password = signal('x');
  protected readonly threads = signal(4);
  protected readonly inElectron = signal(false);
  protected readonly info = signal<MinerInfo | null>(null);
  protected readonly stats = signal<MinerStats>({
    running: false,
    hashrate: 0,
    height: 0,
    hashes: 0,
    accepted: 0,
    rejected: 0,
    lastError: '',
    lastHash: '',
    status: 'idle',
  });
  protected readonly formError = signal('');
  protected readonly toast = signal('');
  private unsub: (() => void)[] = [];
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    const api = window.miner;
    this.inElectron.set(!!api);
    if (!api) {
      return;
    }
    this.info.set(await api.info());
    const inf = this.info();
    const savedMode = localStorage.getItem(App.modeKey);
    this.mode.set(savedMode === 'stratum' ? 'stratum' : 'rpc');
    const saved = localStorage.getItem(App.datadirKey)?.trim();
    this.datadir.set(saved || inf?.datadir || '');
    this.host.set(localStorage.getItem(App.hostKey)?.trim() || '127.0.0.1');
    this.port.set(this.loadPort(this.mode()));
    this.worker.set(localStorage.getItem(App.workerKey) ?? '');
    this.password.set(localStorage.getItem(App.passwordKey) ?? 'x');
    const n = inf?.defaultThreads;
    if (n && n > 0) {
      this.threads.set(n);
    }
    this.unsub.push(api.onStats((s) => this.stats.set(s)));
    this.unsub.push(
      api.onToast((message) => {
        this.toast.set(message);
        if (this.toastTimer) {
          clearTimeout(this.toastTimer);
        }
        this.toastTimer = setTimeout(() => this.toast.set(''), 5000);
      }),
    );
  }

  ngOnDestroy(): void {
    for (const u of this.unsub) {
      u();
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
  }

  protected defaultPort(mode: MinerMode = this.mode()): number {
    return mode === 'stratum' ? 23334 : 35332;
  }

  private portKey(mode: MinerMode): string {
    return mode === 'stratum' ? App.portStratumKey : App.portRpcKey;
  }

  private loadPort(mode: MinerMode): number {
    const saved = localStorage.getItem(this.portKey(mode));
    return saved ? Number.parseInt(saved, 10) || this.defaultPort(mode) : this.defaultPort(mode);
  }

  protected setMode(mode: MinerMode): void {
    this.mode.set(mode);
    localStorage.setItem(App.modeKey, mode);
    this.port.set(this.loadPort(mode));
  }

  protected async start(): Promise<void> {
    const api = window.miner;
    if (!api) {
      this.formError.set('Open this app with npm start (Electron), not ng serve.');
      return;
    }
    this.formError.set('');
    const r = await api.start(
      this.mode() === 'stratum'
        ? {
            mode: 'stratum',
            threads: this.threads(),
            host: this.host(),
            port: this.port(),
            worker: this.worker(),
            password: this.password(),
          }
        : {
            mode: 'rpc',
            threads: this.threads(),
            host: this.host(),
            port: this.port(),
            payout: this.payout(),
            datadir: this.datadir(),
          },
    );
    if (!r.ok) {
      this.formError.set(r.error ?? 'start failed');
    }
  }

  protected async stop(): Promise<void> {
    await window.miner?.stop();
  }

  protected setDatadir(value: string): void {
    this.datadir.set(value);
    localStorage.setItem(App.datadirKey, value);
  }

  protected setHost(value: string): void {
    this.host.set(value);
    localStorage.setItem(App.hostKey, value);
  }

  protected setPort(value: string): void {
    const n = Number.parseInt(value, 10);
    this.port.set(n || this.defaultPort());
    localStorage.setItem(this.portKey(this.mode()), String(this.port()));
  }

  protected setWorker(value: string): void {
    this.worker.set(value);
    localStorage.setItem(App.workerKey, value);
  }

  protected setPassword(value: string): void {
    this.password.set(value);
    localStorage.setItem(App.passwordKey, value);
  }

  protected async browseDatadir(): Promise<void> {
    const p = await window.miner?.pickDatadir();
    if (p) {
      this.setDatadir(p);
    }
  }

  protected cookieHint(): string {
    const d = this.datadir().trim().replace(/[/\\]+$/, '');
    if (!d) {
      return this.info()?.cookiePath ?? '';
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
