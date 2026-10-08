import { Component, DestroyRef, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { CHAINS, type MinerChain } from './chain';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import { mainIsNotLive } from './miner-format';
import { AddonMissingCard } from './addon-missing-card';
import { NodeDownloadCta } from './node-download-cta';
import { ExtrasService } from './extras.service';
import { ListenReachField, type ListenReach } from './listen-reach';
import { ProcessCard } from './process-card';
import { EMPTY_GATEWAY_STATUS, type GatewayStatusView } from './miner-api';
import { HOUSE_HINTS } from './house-hints';
import { PrimePinService } from './prime-pin.service';
import { MiningService } from './mining.service';
import { identityPubkeyFromKeysDocument } from './prime-keys';

const POLL_MS = 3000;

@Component({
  selector: 'app-gateway-pane',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    AddonMissingCard,
    NodeDownloadCta,
    ProcessCard,
    ListenReachField,
  ],
  templateUrl: './gateway-pane.html',
  styleUrl: './gateway-pane.css',
  host: { '[attr.data-chain]': 'chain()' },
})
export class GatewayPane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  protected readonly extras = inject(ExtrasService);
  private readonly host = inject(HASHER_HOST);
  private readonly destroyRef = inject(DestroyRef);
  private readonly primePin = inject(PrimePinService);
  private readonly mining = inject(MiningService);
  protected readonly hints = HOUSE_HINTS;
  protected readonly status = signal<GatewayStatusView>(EMPTY_GATEWAY_STATUS);
  protected readonly phase = signal<'idle' | 'starting' | 'stopping'>('idle');
  protected readonly error = signal('');
  protected readonly fetchedKey = signal('');
  protected readonly configPath = new FormControl('', { nonNullable: true });
  protected readonly webForm = new FormGroup({
    url: new FormControl<string>(HOUSE_HINTS.gatewayWss, { nonNullable: true }),
  });
  protected readonly deskForm = new FormGroup({
    poolHost: new FormControl('', { nonNullable: true }),
    primeIdentity: new FormControl<'pubkey' | 'url'>('pubkey', { nonNullable: true }),
    poolPubkey: new FormControl('', { nonNullable: true }),
    keysUrl: new FormControl('', { nonNullable: true }),
    listenReach: new FormControl<ListenReach>('computer', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const pin = this.primePin.pin();
      if (!pin || this.isWeb()) {
        return;
      }
      this.deskForm.controls.poolHost.setValue(pin.hostPort);
      if (pin.keysUrl) {
        this.deskForm.controls.primeIdentity.setValue('url');
        this.deskForm.controls.keysUrl.setValue(pin.keysUrl);
        this.deskForm.controls.poolPubkey.setValue('');
      } else if (pin.identityPubkey) {
        this.deskForm.controls.primeIdentity.setValue('pubkey');
        this.deskForm.controls.poolPubkey.setValue(pin.identityPubkey);
        this.deskForm.controls.keysUrl.setValue('');
      }
      this.fetchedKey.set('');
      this.primePin.clear();
    });
  }

  ngOnInit(): void {
    const savedReach = localStorage.getItem(`fc.${this.chain()}.gateway.listen`);
    if (savedReach === 'network' || savedReach === 'computer') {
      this.deskForm.controls.listenReach.setValue(savedReach);
    }
    this.deskForm.controls.listenReach.valueChanges.subscribe((value) => {
      localStorage.setItem(`fc.${this.chain()}.gateway.listen`, value);
    });
    const saved = localStorage.getItem(`fc.${this.chain()}.datumGatewayWebsocket.url`);
    if (saved) {
      this.webForm.controls.url.setValue(saved);
    }
    this.webForm.valueChanges.subscribe((v) => {
      localStorage.setItem(`fc.${this.chain()}.datumGatewayWebsocket.url`, v.url ?? '');
    });
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  protected isWeb(): boolean {
    return this.shell.kind === 'webDemo';
  }

  protected extraPresent(): boolean {
    return this.extras.probe().gateway;
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
    if (!this.host.gatewayStatus || this.isWeb()) {
      return;
    }
    const next = {
      ...EMPTY_GATEWAY_STATUS,
      ...(await this.host.gatewayStatus({ chain: this.chain(), configPath: this.configPath.value })),
    };
    this.status.set(next);
    if (next.session !== 'idle' || this.phase() !== 'idle') {
      this.configPath.setValue(next.configPath, { emitEvent: false });
      this.configPath.disable({ emitEvent: false });
      this.deskForm.disable({ emitEvent: false });
      return;
    }
    this.configPath.enable({ emitEvent: false });
    this.deskForm.enable({ emitEvent: false });
    if (!this.configPath.dirty && next.configPath) {
      this.configPath.setValue(next.configPath, { emitEvent: false });
    }
  }

  protected identityKind(): 'pubkey' | 'url' {
    return this.deskForm.controls.primeIdentity.value;
  }

  protected async start(): Promise<void> {
    if (this.phase() !== 'idle') {
      return;
    }
    this.error.set('');
    const v = this.deskForm.getRawValue();
    const host = v.poolHost.trim();
    let pub = '';
    if (host) {
      if (v.primeIdentity === 'pubkey') {
        pub = v.poolPubkey.trim().toLowerCase();
      } else {
        const hex = await this.loadKeysHex(v.keysUrl.trim());
        if (!hex) {
          return;
        }
        pub = hex;
      }
      if (!/^[0-9a-f]{128}$/.test(pub)) {
        const message = 'Prime identity pubkey must be 128 hex characters.';
        this.error.set(message);
        this.mining.warn(message);
        return;
      }
    }
    this.phase.set('starting');
    try {
      if (!this.host.gatewayStart) {
        this.error.set('Gateway start is desktop only.');
        return;
      }
      const r = await this.host.gatewayStart({
        chain: this.chain(),
        poolHost: host,
        poolPubkey: pub,
        configPath: this.configPath.value.trim(),
        listenReach: v.listenReach,
      });
      if (!r.ok) {
        this.error.set(r.error ?? 'start failed');
      }
      this.configPath.markAsPristine();
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
      const r = await this.host.gatewayStop?.();
      if (r && !r.ok) {
        this.error.set(r.error ?? 'stop failed');
      }
    } finally {
      await this.refresh();
      this.phase.set('idle');
    }
  }

  protected async kill(pid: number): Promise<void> {
    this.error.set('');
    const r = await this.host.gatewayKillForeign?.(pid);
    if (r && !r.ok) {
      this.error.set(r.error ?? 'kill failed');
    }
    await this.refresh();
  }

  protected onPath(value: string): void {
    this.configPath.setValue(value);
    this.configPath.markAsDirty();
  }

  protected async fetchKeys(): Promise<void> {
    this.fetchedKey.set('');
    const hex = await this.loadKeysHex(this.deskForm.controls.keysUrl.value.trim());
    if (hex) {
      this.fetchedKey.set(hex);
    }
  }

  private async loadKeysHex(url: string): Promise<string> {
    this.error.set('');
    if (!url) {
      this.error.set('Prime keys URL is empty.');
      return '';
    }
    if (!this.host.fetchPrimeKeys) {
      this.error.set('Fetching a keys URL is desktop only.');
      return '';
    }
    const res = await this.host.fetchPrimeKeys(url);
    if (!res.ok || !res.text) {
      this.error.set(res.error ?? 'keys fetch failed');
      return '';
    }
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      this.error.set('Keys document is not JSON.');
      return '';
    }
    const hex = identityPubkeyFromKeysDocument(json);
    if (!hex) {
      this.error.set('Keys document needs ed25519 and x25519 public keys.');
      return '';
    }
    return hex;
  }
}
