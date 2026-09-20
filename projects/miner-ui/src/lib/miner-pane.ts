import { Component, DestroyRef, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { GpuAdapter, GpuPick, GpuStrategy, MineTo, MineToKind, MinerStartOpts, MinerStats } from './miner-api';
import { isWebStratumKind, STRATUM_PASSWORD } from './miner-api';
import { CHAINS, type ChainConfig, type MinerChain } from './chain';
import { formatHashRate, gpuStatusHint, gpuStatusHintWeb, mainIsNotLive } from './miner-format';
import {
  liveGpuPicks,
  migrateGpuIds,
  parseGpuPicks,
  pickForAdapter,
  setAdapterPick,
  strategyKindLabel,
} from './gpu-catalog';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import { IDLE_STATS, MiningService } from './mining.service';
import { RpcConnect, rpcConnectGroup, rpcConnectValue, type RpcConnectForm } from './rpc-connect';
import { isLoopbackWsHost, isTcpStratumEndpoint, peerStatusLabel, stratumWsUrl, type GatewayInfoRpc, type PeerStatus } from './stratum-ws';
import { DefaultsFold } from './defaults-fold';
import { WebgpuHelp } from './webgpu-help';

const GATEWAY_INFO_DEBOUNCE_MS = 5000;

const LOOPBACK_GATEWAY_TOOLTIP =
  'localhost gateway needs Apps On Device; if you rejected the prompt and still want to mine to a localhost DATUM Gateway, re-enable it in site settings';

export type GatewayInfoView =
  | { kind: 'notRequested' }
  | { kind: 'notProvided'; asOf: number }
  | {
      kind: 'provided';
      asOf: number;
      nodeStatus: PeerStatus;
      name: string;
      coinbaseTag: string;
      websiteUrl: string;
      prime?: string;
      poolStatus?: PeerStatus;
    };

const DROPPED_KINDS = new Set([
  'datum',
  'datumWebsocket',
  'appPoolStratum',
  'appPoolDatum',
  'hostedPoolStratum',
  'stratumWebsocket',
]);

function emptyWsGroup(): FormGroup<{ url: FormControl<string>; worker: FormControl<string> }> {
  return new FormGroup({
    url: new FormControl('', { nonNullable: true }),
    worker: new FormControl('', { nonNullable: true }),
  });
}

@Component({
  selector: 'app-miner-pane',
  imports: [
    ReactiveFormsModule,
    RpcConnect,
    DefaultsFold,
    WebgpuHelp,
    MatRadioModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatTooltipModule,
  ],
  styleUrl: './miner-pane.css',
  templateUrl: './miner-pane.html',
  host: { '[attr.data-chain]': 'chain()' },
})
export class MinerPane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly mining = inject(MiningService);
  protected readonly shell = inject(MINER_SHELL);
  private readonly host = inject(HASHER_HOST);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly gpuPicks = signal<GpuPick[]>([]);
  protected readonly gpuDetecting = signal(false);
  protected readonly webgpuHelpAutoOpen = signal(false);
  protected readonly formError = signal('');
  protected readonly gatewayInfoView = signal<GatewayInfoView>({ kind: 'notRequested' });
  protected readonly loopbackGatewayTooltip = LOOPBACK_GATEWAY_TOOLTIP;
  private lastGatewayInfoAt = 0;

  protected readonly form = new FormGroup({
    kind: new FormControl<MineToKind>('node', { nonNullable: true }),
    payout: new FormControl('', { nonNullable: true }),
    rpc: rpcConnectGroup(35332),
    stratum: new FormGroup({
      host: new FormControl('127.0.0.1', { nonNullable: true }),
      port: new FormControl(23334, { nonNullable: true }),
      worker: new FormControl('', { nonNullable: true }),
      password: new FormControl(STRATUM_PASSWORD, { nonNullable: true }),
    }),
    poolWebsocket: emptyWsGroup(),
    gatewayWebsocket: emptyWsGroup(),
    threads: new FormControl(4, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const inf = this.mining.info();
      if (!inf) {
        return;
      }
      this.patchEmptyDatadir('rpc.datadir', this.form.controls.rpc.controls.cookie, inf.datadir);
      if (!localStorage.getItem(this.key('threads')) && inf.defaultThreads > 0) {
        this.form.controls.threads.setValue(inf.defaultThreads, { emitEvent: false });
      }
    });
  }

  ngOnInit(): void {
    const d = this.shell.defaults.chains[this.chain()];
    if (this.isWebDemo()) {
      const web = d as {
        stratumPoolWebsocket: { url: string };
        datumGatewayWebsocket: { url: string };
      };
      this.form.controls.poolWebsocket.patchValue({
        url: this.loadWebsocketUrl('stratumPoolWebsocket', web.stratumPoolWebsocket.url),
        worker: this.loadWebsocketWorker('stratumPoolWebsocket'),
      });
      this.form.controls.gatewayWebsocket.patchValue({
        url: this.loadWebsocketUrl('datumGatewayWebsocket', web.datumGatewayWebsocket.url),
        worker: this.loadWebsocketWorker('datumGatewayWebsocket'),
      });
    } else {
      const desk = d as { stratum: { host: string; port: number; password: string }; rpc: { host: string; port: number } };
      this.form.controls.stratum.patchValue(this.loadStratum(desk.stratum));
      this.form.controls.rpc.patchValue(this.loadRpc('rpc', desk.rpc));
    }
    this.form.controls.payout.setValue(localStorage.getItem(this.key('payout')) ?? '');
    const savedThreads = localStorage.getItem(this.key('threads'));
    if (savedThreads) {
      this.form.controls.threads.setValue(Number.parseInt(savedThreads, 10) || 4);
    } else if ((this.mining.info()?.defaultThreads ?? 0) > 0) {
      this.form.controls.threads.setValue(this.mining.info()!.defaultThreads);
    }
    const savedKind = this.loadKind();
    const allowed = this.allowedKinds();
    const fallback = d.mineToKind;
    this.form.controls.kind.setValue(savedKind && allowed.includes(savedKind) ? savedKind : fallback);
    this.gpuPicks.set(this.loadGpuPicks());
    this.form.valueChanges.subscribe(() => this.persist());
    this.form.controls.gatewayWebsocket.controls.url.valueChanges.subscribe(() => {
      this.gatewayInfoView.set({ kind: 'notRequested' });
    });
    const unsubInfo = this.host.onGatewayInfo?.((info) => this.applyGatewayInfoRpc(info));
    this.destroyRef.onDestroy(() => unsubInfo?.());
    this.persist();
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

  protected linkLabel(): string {
    switch (this.paneStats().link) {
      case 'up':
        return 'Stratum up';
      case 'down':
        return 'Stratum down';
      default:
        return 'Stratum idle';
    }
  }

  protected startDisabled(): boolean {
    return !this.mining.canMine() || this.mining.activeChain() === this.chain();
  }

  protected stopDisabled(): boolean {
    return !this.mining.canMine() || this.mining.activeChain() !== this.chain();
  }

  protected isWebDemo(): boolean {
    return this.shell.kind === 'webDemo';
  }

  protected allowedKinds(): MineToKind[] {
    return this.isWebDemo() ? ['stratumPoolWebsocket', 'datumGatewayWebsocket'] : ['node', 'stratum'];
  }

  protected kindLocked(): boolean {
    return this.mining.activeChain() === this.chain();
  }

  protected kind(): MineToKind {
    return this.form.controls.kind.value;
  }

  protected gatewayLoopbackWarning(): boolean {
    return this.kind() === 'datumGatewayWebsocket' && isLoopbackWsHost(this.form.controls.gatewayWebsocket.controls.url.value);
  }

  protected async fetchGatewayInfo(): Promise<void> {
    if (this.kind() !== 'datumGatewayWebsocket') {
      return;
    }
    const now = Date.now();
    if (now - this.lastGatewayInfoAt < GATEWAY_INFO_DEBOUNCE_MS) {
      return;
    }
    this.lastGatewayInfoAt = now;
    if (this.host.miningSocketOpen?.()) {
      this.host.requestGatewayInfo?.();
      return;
    }
    const url = this.form.controls.gatewayWebsocket.controls.url.value.trim();
    if (!url || !this.host.fetchGatewayInfo) {
      return;
    }
    const info = await this.host.fetchGatewayInfo(url);
    this.applyGatewayInfoRpc(info);
  }

  protected formatGatewayInfoAsOf(asOf: number): string {
    return new Date(asOf).toLocaleString();
  }

  protected statusLabel(status: PeerStatus): string {
    return peerStatusLabel(status);
  }

  private applyGatewayInfoRpc(info: GatewayInfoRpc): void {
    const asOf = Date.now();
    if (info.kind === 'provided') {
      this.gatewayInfoView.set({ kind: 'provided', asOf, ...info.fields });
      return;
    }
    this.gatewayInfoView.set({ kind: 'notProvided', asOf });
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
    return {
      chain: this.chain(),
      threads: this.form.controls.threads.value,
      gpus: this.gpuPicks(),
      mineTo: this.mineTo(),
    };
  }

  private mineTo(): MineTo {
    const kind = this.kind();
    if (kind === 'node') {
      return { kind: 'node', rpc: rpcConnectValue(this.form.controls.rpc), payout: this.form.controls.payout.value };
    }
    if (kind === 'stratum') {
      return { kind: 'stratum', stratum: this.form.controls.stratum.getRawValue() };
    }
    if (kind === 'datumGatewayWebsocket') {
      const ws = this.form.controls.gatewayWebsocket.getRawValue();
      return { kind: 'datumGatewayWebsocket', url: ws.url.trim(), worker: ws.worker };
    }
    const ws = this.form.controls.poolWebsocket.getRawValue();
    return { kind: 'stratumPoolWebsocket', url: ws.url.trim(), worker: ws.worker };
  }

  private persist(): void {
    const v = this.form.getRawValue();
    localStorage.setItem(this.key('kind'), v.kind);
    localStorage.setItem(this.key('payout'), v.payout);
    localStorage.setItem(this.key('threads'), String(v.threads));
    if (this.isWebDemo()) {
      localStorage.setItem(this.key('stratumPoolWebsocket.url'), v.poolWebsocket.url);
      localStorage.setItem(this.key('stratumPoolWebsocket.worker'), v.poolWebsocket.worker);
      localStorage.setItem(this.key('datumGatewayWebsocket.url'), v.gatewayWebsocket.url);
      localStorage.setItem(this.key('datumGatewayWebsocket.worker'), v.gatewayWebsocket.worker);
      return;
    }
    this.persistRpc('rpc', v.rpc);
    localStorage.setItem(this.key('stratum.host'), v.stratum.host);
    localStorage.setItem(this.key('stratum.port'), String(v.stratum.port));
    localStorage.setItem(this.key('stratum.worker'), v.stratum.worker);
    localStorage.setItem(this.key('stratum.password'), v.stratum.password);
  }

  private key(suffix: string): string {
    return `fc.${this.chain()}.${suffix}`;
  }

  private loadNum(suffix: string, fallback: number): number {
    const saved = localStorage.getItem(this.key(suffix));
    return saved ? Number.parseInt(saved, 10) || fallback : fallback;
  }

  private loadKind(): MineToKind | null {
    const saved = localStorage.getItem(this.key('kind'));
    if (!saved) {
      return null;
    }
    if (this.isWebDemo()) {
      if (isWebStratumKind(saved as MineToKind)) {
        return saved as MineToKind;
      }
      if (saved === 'stratum' || DROPPED_KINDS.has(saved)) {
        return 'stratumPoolWebsocket';
      }
      return null;
    }
    if (saved === 'node' || saved === 'stratum') {
      return saved;
    }
    if (isWebStratumKind(saved as MineToKind) || DROPPED_KINDS.has(saved)) {
      return 'stratum';
    }
    return null;
  }

  private loadStratum(fallback: { host: string; port: number; password: string }) {
    const savedHost = localStorage.getItem(this.key('stratum.host'))?.trim() ?? '';
    const savedPortRaw = localStorage.getItem(this.key('stratum.port'));
    const savedPort = savedPortRaw ? Number.parseInt(savedPortRaw, 10) : 0;
    const hostPort = !savedHost || !savedPort ? { host: fallback.host, port: fallback.port } : { host: savedHost, port: savedPort };
    return {
      host: hostPort.host,
      port: hostPort.port,
      worker: localStorage.getItem(this.key('stratum.worker')) ?? '',
      password: localStorage.getItem(this.key('stratum.password')) ?? fallback.password,
    };
  }

  private loadWebsocketUrl(kind: 'stratumPoolWebsocket' | 'datumGatewayWebsocket', fallback: string): string {
    const saved = localStorage.getItem(this.key(`${kind}.url`))?.trim();
    if (saved) {
      return saved;
    }
    if (kind === 'stratumPoolWebsocket') {
      const legacyUrl = localStorage.getItem(this.key('stratumWebsocket.url'))?.trim();
      if (legacyUrl) {
        return legacyUrl;
      }
      const wsHost = localStorage.getItem(this.key('stratumWebsocket.host'))?.trim() ?? '';
      const wsPortRaw = localStorage.getItem(this.key('stratumWebsocket.port'));
      const wsPort = wsPortRaw ? Number.parseInt(wsPortRaw, 10) : 0;
      if (wsHost && wsPort && !isTcpStratumEndpoint(wsHost, wsPort)) {
        return stratumWsUrl(wsHost, wsPort);
      }
    }
    return fallback;
  }

  private loadWebsocketWorker(kind: 'stratumPoolWebsocket' | 'datumGatewayWebsocket'): string {
    return (
      localStorage.getItem(this.key(`${kind}.worker`)) ??
      localStorage.getItem(this.key('stratumWebsocket.worker')) ??
      localStorage.getItem(this.key('hostedPoolStratum.worker')) ??
      localStorage.getItem(this.key('stratum.worker')) ??
      ''
    );
  }

  private loadRpc(prefix: string, fallback: { host: string; port: number }) {
    const authKind = localStorage.getItem(this.key(`${prefix}.authKind`));
    return {
      host: localStorage.getItem(this.key(`${prefix}.host`))?.trim() || fallback.host,
      port: this.loadNum(`${prefix}.port`, fallback.port),
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
    return !this.mining.canMine() || this.kindLocked() || this.gpuDetecting();
  }

  protected gpuHint(): string {
    const state = {
      detecting: this.gpuDetecting(),
      scanned: this.mining.gpuScanned(),
      addon: this.mining.gpuAddon(),
      deviceCount: this.gpuList().length,
      reason: this.mining.gpuReason(),
    };
    return this.isWebDemo() ? gpuStatusHintWeb(state) : gpuStatusHint(state);
  }

  protected webGpuHelpVisible(): boolean {
    if (this.mining.hasWebGpuStrategy()) {
      return false;
    }
    return this.mining.gpuScanned() || this.isWebDemo();
  }

  protected async detectGpus(): Promise<void> {
    if (this.gpuDetectDisabled()) {
      return;
    }
    this.gpuDetecting.set(true);
    try {
      await this.mining.refreshGpus();
      this.gpuPicks.set(this.reconcilePicks());
      this.persistGpuPicks();
      if (this.webGpuHelpVisible()) {
        this.webgpuHelpAutoOpen.set(true);
      }
    } finally {
      this.gpuDetecting.set(false);
    }
  }

  protected gpuPickKind(adapterKey: string): GpuStrategy['kind'] | 'off' {
    return pickForAdapter(this.gpuPicks(), adapterKey)?.strategy.kind ?? 'off';
  }

  protected strategyKindLabel(kind: GpuStrategy['kind']): string {
    return strategyKindLabel(kind);
  }

  protected gpuAdapterHint(dev: GpuAdapter): string {
    const mem = dev.memoryMiB > 0 ? `${dev.memoryMiB} MiB · ` : '';
    return `${mem}${dev.deviceKind}`;
  }

  protected gpuDomId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]+/g, '-');
  }

  protected setGpuStrategy(adapterKey: string, strategy: GpuStrategy | null): void {
    const next = setAdapterPick(this.gpuPicks(), adapterKey, strategy);
    this.gpuPicks.set(next);
    this.persistGpuPicks();
  }

  private persistGpuPicks(): void {
    localStorage.setItem(this.key('gpuPicks'), JSON.stringify(this.gpuPicks()));
  }

  private loadGpuPicks(): GpuPick[] {
    const raw = localStorage.getItem(this.key('gpuPicks'));
    if (!raw) {
      return [];
    }
    try {
      return liveGpuPicks(parseGpuPicks(JSON.parse(raw)), this.mining.gpuDevices());
    } catch {
      return [];
    }
  }

  private reconcilePicks(): GpuPick[] {
    const adapters = this.mining.gpuDevices();
    const live = liveGpuPicks(this.gpuPicks(), adapters);
    if (live.length > 0 || adapters.length === 0) {
      return live;
    }
    const raw = localStorage.getItem(this.key('gpuIds'));
    if (!raw) {
      return live;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return live;
      }
      const ids = parsed.filter((id): id is string => typeof id === 'string');
      return migrateGpuIds(ids, adapters);
    } catch {
      return live;
    }
  }

  protected gpuSummary(): string {
    const adapters = this.gpuList();
    const selected = this.gpuPicks()
      .map((p) => {
        const adapter = adapters.find((a) => a.key === p.adapter);
        if (!adapter) {
          return '';
        }
        return `${adapter.label} (${strategyKindLabel(p.strategy.kind)})`;
      })
      .filter(Boolean);
    if (selected.length === 0) {
      return 'none';
    }
    return selected.join(', ');
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
    if (kind === 'datumGatewayWebsocket') {
      return `${this.form.controls.gatewayWebsocket.getRawValue().url} (gateway websocket)`;
    }
    return `${this.form.controls.poolWebsocket.getRawValue().url} (pool websocket)`;
  }

  protected formatRate(n: number): string {
    return formatHashRate(n);
  }

  protected rpcCookie(form: RpcConnectForm): boolean {
    return form.controls.authKind.value === 'cookie';
  }

  protected rpcSummary(form: RpcConnectForm): string {
    const v = form.getRawValue();
    return `${v.host}:${v.port}`;
  }
}
