import { Component, OnInit, inject, input, signal } from '@angular/core';
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
import type { GatewayStatusView } from './miner-api';

@Component({
  selector: 'app-gateway-pane',
  imports: [ReactiveFormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, AddonMissingCard, NodeDownloadCta],
  templateUrl: './gateway-pane.html',
  host: { '[attr.data-chain]': 'chain()' },
})
export class GatewayPane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  protected readonly extras = inject(ExtrasService);
  private readonly host = inject(HASHER_HOST);
  protected readonly status = signal<GatewayStatusView>({ session: 'idle', running: false, lastError: '' });
  protected readonly error = signal('');
  protected readonly webForm = new FormGroup({
    url: new FormControl('ws://127.0.0.1:23335/stratum', { nonNullable: true }),
  });
  protected readonly deskForm = new FormGroup({
    poolAddress: new FormControl('', { nonNullable: true }),
    poolHost: new FormControl('', { nonNullable: true }),
    poolPubkey: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    const saved = localStorage.getItem(`fc.${this.chain()}.datumGatewayWebsocket.url`);
    if (saved) {
      this.webForm.controls.url.setValue(saved);
    }
    this.webForm.valueChanges.subscribe((v) => {
      localStorage.setItem(`fc.${this.chain()}.datumGatewayWebsocket.url`, v.url ?? '');
    });
    void this.refresh();
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

  protected showStop(): boolean {
    return this.status().session === 'spawned';
  }

  protected async refresh(): Promise<void> {
    if (!this.host.gatewayStatus) {
      return;
    }
    this.status.set(await this.host.gatewayStatus());
  }

  protected async start(): Promise<void> {
    this.error.set('');
    if (!this.host.gatewayStart) {
      this.error.set('Gateway start is desktop only.');
      return;
    }
    const v = this.deskForm.getRawValue();
    const r = await this.host.gatewayStart({
      chain: this.chain(),
      poolAddress: v.poolAddress.trim(),
      poolHost: v.poolHost.trim(),
      poolPubkey: v.poolPubkey.trim(),
    });
    if (!r.ok) {
      this.error.set(r.error ?? 'start failed');
    }
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
}
