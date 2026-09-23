import { Component, DestroyRef, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CHAINS, type MinerChain } from './chain';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import { mainIsNotLive } from './miner-format';
import { AddonMissingCard } from './addon-missing-card';
import { NodeDownloadCta } from './node-download-cta';
import { ExtrasService } from './extras.service';
import { ProcessCard } from './process-card';
import { EMPTY_GATEWAY_STATUS, type GatewayStatusView } from './miner-api';
import { HOUSE_HINTS } from './house-hints';
import { PrimePinService } from './prime-pin.service';
import { applyFetchedIdentity, identityPubkeyFromKeysDocument } from './prime-keys';

const POLL_MS = 3000;

@Component({
  selector: 'app-gateway-pane',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    AddonMissingCard,
    NodeDownloadCta,
    ProcessCard,
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
  protected readonly hints = HOUSE_HINTS;
  protected readonly status = signal<GatewayStatusView>(EMPTY_GATEWAY_STATUS);
  protected readonly error = signal('');
  protected readonly fetchedKey = signal('');
  protected readonly fetchMismatch = signal(false);
  protected readonly configPath = new FormControl('', { nonNullable: true });
  protected readonly webForm = new FormGroup({
    url: new FormControl<string>(HOUSE_HINTS.gatewayWss, { nonNullable: true }),
  });
  protected readonly deskForm = new FormGroup({
    poolAddress: new FormControl('', { nonNullable: true }),
    poolHost: new FormControl('', { nonNullable: true }),
    poolPubkey: new FormControl('', { nonNullable: true }),
    keysUrl: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const pin = this.primePin.pin();
      if (!pin || this.isWeb()) {
        return;
      }
      this.deskForm.controls.poolHost.setValue(pin.hostPort);
      if (pin.identityPubkey) {
        this.deskForm.controls.poolPubkey.setValue(pin.identityPubkey);
      }
      if (pin.keysUrl) {
        this.deskForm.controls.keysUrl.setValue(pin.keysUrl);
      }
      this.fetchedKey.set('');
      this.fetchMismatch.set(false);
      this.primePin.clear();
    });
  }

  ngOnInit(): void {
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
    return this.status().session === 'idle' && !this.showMainWarning();
  }

  protected showStop(): boolean {
    return this.status().session === 'spawned';
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
    if (next.session !== 'idle') {
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

  protected async start(): Promise<void> {
    this.error.set('');
    if (!this.host.gatewayStart) {
      this.error.set('Gateway start is desktop only.');
      return;
    }
    const v = this.deskForm.getRawValue();
    const host = v.poolHost.trim();
    const pub = v.poolPubkey.trim().toLowerCase();
    if (host && !/^[0-9a-f]{128}$/.test(pub)) {
      this.error.set('Prime identity pubkey must be 128 hex characters.');
      return;
    }
    const r = await this.host.gatewayStart({
      chain: this.chain(),
      poolAddress: v.poolAddress.trim(),
      poolHost: host,
      poolPubkey: pub,
      configPath: this.configPath.value.trim(),
    });
    if (!r.ok) {
      this.error.set(r.error ?? 'start failed');
    }
    this.configPath.markAsPristine();
    await this.refresh();
  }

  protected async stop(): Promise<void> {
    this.error.set('');
    const r = await this.host.gatewayStop?.();
    if (r && !r.ok) {
      this.error.set(r.error ?? 'stop failed');
    }
    await this.refresh();
  }

  protected onPath(value: string): void {
    this.configPath.setValue(value);
    this.configPath.markAsDirty();
  }

  protected async fetchKeys(): Promise<void> {
    this.error.set('');
    this.fetchedKey.set('');
    this.fetchMismatch.set(false);
    const url = this.deskForm.controls.keysUrl.value.trim();
    if (!url) {
      this.error.set('Prime keys URL is empty.');
      return;
    }
    if (!this.host.fetchPrimeKeys) {
      this.error.set('Fetching a keys URL is desktop only.');
      return;
    }
    const res = await this.host.fetchPrimeKeys(url);
    if (!res.ok || !res.text) {
      this.error.set(res.error ?? 'keys fetch failed');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      this.error.set('Keys document is not JSON.');
      return;
    }
    const hex = identityPubkeyFromKeysDocument(json);
    if (!hex) {
      this.error.set('Keys document needs ed25519 and x25519 public keys.');
      return;
    }
    const applied = applyFetchedIdentity(this.deskForm.controls.poolPubkey.value, hex);
    this.fetchedKey.set(hex);
    this.fetchMismatch.set(applied.mismatch);
    if (applied.mismatch) {
      this.error.set('Fetched key does not match the identity pubkey. The pin was left unchanged.');
    }
  }

  protected useFetchedKey(): void {
    const hex = this.fetchedKey();
    const applied = applyFetchedIdentity(this.deskForm.controls.poolPubkey.value, hex);
    if (applied.mismatch || !applied.pubkey) {
      return;
    }
    this.deskForm.controls.poolPubkey.setValue(applied.pubkey);
    this.fetchMismatch.set(false);
    this.error.set('');
  }
}
