import { Component, DestroyRef, ElementRef, NgZone, effect, inject, input, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { debounceTime } from 'rxjs';
import type { MinerChain } from './chain';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import { MiningService } from './mining.service';
import { formatSats } from './miner-format';
import { applyDesktopStratumTarget, applyWebPoolWssTarget } from './mine-target';
import { WorkspaceNav } from './workspace-nav';
import {
  advertisedAttestKinds,
  attestConnectFromListing,
  envelopeAuthorization,
  listingCanMineThis,
  listingPrimeAdvertise,
  listingStratumWssUrl,
  mainFinderLive,
  registryFetch,
  signedPayloadHash,
  sparrowSignatureToBase64Url,
  type AttestConnect,
  type AttestKind,
  type FindGroup,
  type ListingPublic,
  type RegistryConnect,
  type RegistryRequest,
} from './registry';

@Component({
  selector: 'app-finder-pane',
  imports: [ReactiveFormsModule, MatButtonModule, MatCardModule],
  styleUrl: './miner-pane.css',
  templateUrl: './finder-pane.html',
})
export class FinderPane {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  protected readonly mining = inject(MiningService);
  private readonly nav = inject(WorkspaceNav);
  private readonly host = inject(HASHER_HOST);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly attestDialog = viewChild<ElementRef<HTMLDialogElement>>('attestDialog');
  protected readonly notice = signal('');
  protected readonly error = signal('');
  protected readonly groups = signal<FindGroup[]>([]);
  protected readonly inactive = signal(false);
  protected readonly sparrowMessage = signal('');
  protected readonly commandJson = signal('');
  protected readonly attestSummary = signal('');
  protected readonly attestCommandJson = signal('');
  protected readonly attestSparrowMessage = signal('');
  protected readonly stakeKind = signal('');
  protected readonly stakeLine = signal('');
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    websiteUrl: new FormControl('', { nonNullable: true }),
    coinbaseTag: new FormControl('', { nonNullable: true }),
    connectKind: new FormControl<'stratumOnly' | 'datumOnly' | 'stratumAndDatum'>('stratumAndDatum', {
      nonNullable: true,
    }),
    stratum: new FormControl('', { nonNullable: true }),
    datum: new FormControl('', { nonNullable: true }),
    wallet: new FormControl('', { nonNullable: true }),
    signature: new FormControl('', { nonNullable: true }),
    signingBlockHash: new FormControl('', { nonNullable: true }),
    signingBlockHeight: new FormControl('', { nonNullable: true }),
  });
  protected readonly attestForm = new FormGroup({
    wallet: new FormControl('', { nonNullable: true }),
    coinbaseHeight: new FormControl('', { nonNullable: true }),
    signature: new FormControl('', { nonNullable: true }),
    signingBlockHash: new FormControl('', { nonNullable: true }),
    signingBlockHeight: new FormControl('', { nonNullable: true }),
  });
  private pendingRegister: unknown;
  private pendingAttest:
    | { poolId: string; connect: AttestConnect }
    | undefined;

  constructor() {
    effect(() => {
      const chain = this.chain();
      void chain;
      this.zone.run(() => {
        void this.reloadListings();
        void this.fillSignContext();
      });
    });
    this.form.controls.wallet.valueChanges.pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe((wallet) => {
      void this.previewStake(wallet);
    });
  }

  protected id(suffix: string): string {
    return `${this.chain()}-finder-${suffix}`;
  }

  protected liveTenant(): boolean {
    return mainFinderLive(this.chain());
  }

  protected isDesktop(): boolean {
    return this.shell.kind === 'desktop';
  }

  protected baseUrl(): string {
    return this.shell.defaults.registryBaseUrl.replace(/\/$/, '');
  }

  protected advertisedKinds(p: ListingPublic): AttestKind[] {
    return advertisedAttestKinds(p.connect);
  }

  protected canMineThis(p: ListingPublic): boolean {
    return listingCanMineThis(p.connect, this.shell.kind === 'webDemo');
  }

  protected primeAdvertise(p: ListingPublic): { host: string; port: number } | null {
    return listingPrimeAdvertise(p.connect);
  }

  protected attestHostPort(p: ListingPublic, kind: AttestKind): string {
    const c = attestConnectFromListing(p.connect, kind);
    return c ? `${c.host}:${c.port}` : '';
  }

  private async transport(req: RegistryRequest) {
    if (this.shell.kind === 'desktop') {
      if (!this.host.registryRequest) {
        throw new Error('Open this app with npm start (Electron), not ng serve.');
      }
      return this.host.registryRequest(req);
    }
    return registryFetch(req, this.baseUrl());
  }

  protected async reloadListings(): Promise<void> {
    this.error.set('');
    if (!mainFinderLive(this.chain())) {
      this.groups.set([]);
      this.stakeLine.set('');
      this.notice.set('Main is not live. Dummy MAIN is not a registry tenant.');
      return;
    }
    const path = this.inactive() ? '/v1/listings/inactive' : '/v1/listings';
    try {
      const res = await this.transport({ method: 'GET', path, chain: this.chain() });
      const body = res.json as { items?: ListingPublic[]; groups?: FindGroup[]; title?: string };
      if (res.status >= 400) {
        this.error.set(body.title ?? 'Find failed');
        this.groups.set([]);
        return;
      }
      const items = body.items ?? [];
      if (body.groups && body.groups.length > 0) {
        this.groups.set(body.groups);
      } else if (items.length > 0) {
        this.groups.set([{ domain: '', listings: items, multipleClaims: false }]);
      } else {
        this.groups.set([]);
      }
      this.notice.set('');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Find failed');
      this.groups.set([]);
    }
  }

  protected async refreshTip(): Promise<void> {
    await this.fillSignContext();
  }

  private async fillSignContext(): Promise<void> {
    if (!mainFinderLive(this.chain())) {
      return;
    }
    try {
      const res = await this.transport({ method: 'GET', path: '/v1/sign-context', chain: this.chain() });
      const body = res.json as {
        signingBlockHeight?: number;
        signingBlockHash?: string;
        stakeRequiredSats?: string;
        mineSeconds?: number;
        title?: string;
      };
      if (res.status >= 400) {
        this.stakeLine.set(body.title ?? '');
        return;
      }
      const height = typeof body.signingBlockHeight === 'number' ? String(body.signingBlockHeight) : '';
      const hash = body.signingBlockHash ?? '';
      if (height) {
        this.form.controls.signingBlockHeight.setValue(height);
        this.attestForm.controls.signingBlockHeight.setValue(height);
      }
      if (hash) {
        this.form.controls.signingBlockHash.setValue(hash);
        this.attestForm.controls.signingBlockHash.setValue(hash);
      }
      const hours = (body.mineSeconds ?? 0) / 3600;
      const hourLabel = hours === 1 ? '1 hour' : `${hours} hours`;
      const shown = body.stakeRequiredSats ? formatSats(body.stakeRequiredSats) : '';
      this.stakeLine.set(
        shown
          ? `Listing stake is ${hourLabel} of RTX 3090 Ti work (${shown} GFCN).`
          : `Listing stake is ${hourLabel} of RTX 3090 Ti work.`,
      );
    } catch {
      this.stakeLine.set('');
    }
  }

  protected toggleInactive(): void {
    this.inactive.set(!this.inactive());
    void this.reloadListings();
  }

  protected connectHint(p: ListingPublic): string {
    const c = p.connect;
    if (c.kind === 'stratumOnly') {
      return `stratum ${c.stratum.host}:${c.stratum.port}`;
    }
    if (c.kind === 'datumOnly') {
      return `datum ${c.datum.host}:${c.datum.port}`;
    }
    return `stratum ${c.stratum.host}:${c.stratum.port} · datum ${c.datum.host}:${c.datum.port}`;
  }

  private connectFromForm(): RegistryConnect {
    const v = this.form.getRawValue();
    const parseHp = (raw: string) => {
      const [host, port] = raw.split(':');
      return { host: host.trim(), port: Number(port) };
    };
    if (v.connectKind === 'stratumOnly') {
      return { kind: 'stratumOnly', stratum: parseHp(v.stratum) };
    }
    if (v.connectKind === 'datumOnly') {
      return { kind: 'datumOnly', datum: parseHp(v.datum) };
    }
    return { kind: 'stratumAndDatum', stratum: parseHp(v.stratum), datum: parseHp(v.datum) };
  }

  private tipFrom(form: { signingBlockHeight: string; signingBlockHash: string }): {
    signingBlockHeight: number;
    signingBlockHash: string;
  } {
    return {
      signingBlockHeight: Number.parseInt(form.signingBlockHeight, 10) || 0,
      signingBlockHash: form.signingBlockHash.trim().toLowerCase(),
    };
  }

  protected composeRegister(): void {
    if (!this.liveTenant()) {
      this.notice.set('Main is not live. Dummy MAIN is not a registry tenant.');
      return;
    }
    this.error.set('');
    const v = this.form.getRawValue();
    const command = {
      commandKind: 'registerListing',
      name: v.name.trim(),
      websiteUrl: v.websiteUrl.trim(),
      coinbaseTag: v.coinbaseTag.trim(),
      connect: this.connectFromForm(),
    };
    const tip = this.tipFrom(v);
    const hash = signedPayloadHash(command, tip.signingBlockHeight, tip.signingBlockHash);
    this.pendingRegister = command;
    this.commandJson.set(JSON.stringify({ command, ...tip }, null, 2));
    this.sparrowMessage.set(hash);
    this.notice.set(
      'Copy the 64-hex message below into federation-sparrow Sign/Verify Format Standard (Electrum). Sign with the listing P2WPKH wallet, then paste the signature.',
    );
  }

  protected async openAttest(p: ListingPublic, kind: AttestKind): Promise<void> {
    const connect = attestConnectFromListing(p.connect, kind);
    if (!connect) {
      return;
    }
    this.pendingAttest = { poolId: p.poolId, connect };
    this.attestSummary.set(`Attest ${kind === 'stratum' ? 'stratum' : 'DATUM'} ${connect.host}:${connect.port} on ${p.name}`);
    this.attestCommandJson.set('');
    this.attestSparrowMessage.set('');
    this.attestForm.controls.signature.setValue('');
    await this.fillSignContext();
    this.attestDialog()?.nativeElement.showModal();
  }

  protected closeAttest(): void {
    this.attestDialog()?.nativeElement.close();
  }

  protected composeAttestCommand(): void {
    if (!this.liveTenant()) {
      this.notice.set('Main is not live. Dummy MAIN is not a registry tenant.');
      return;
    }
    if (!this.pendingAttest) {
      this.notice.set('Pick Attest stratum or Attest DATUM on a listing card first.');
      return;
    }
    this.error.set('');
    const v = this.attestForm.getRawValue();
    const height = Number.parseInt(v.coinbaseHeight, 10) || 0;
    const command = {
      commandKind: 'attestListing',
      poolId: this.pendingAttest.poolId,
      height,
      connect: this.pendingAttest.connect,
    };
    const tip = this.tipFrom(v);
    const hash = signedPayloadHash(command, tip.signingBlockHeight, tip.signingBlockHash);
    this.attestCommandJson.set(JSON.stringify({ command, ...tip }, null, 2));
    this.attestSparrowMessage.set(hash);
    this.notice.set(
      'Copy the attest 64-hex message into federation-sparrow Sign/Verify Format Standard (Electrum). Sign with the attester P2WPKH wallet, then paste the signature.',
    );
  }

  private async previewStake(wallet: string): Promise<void> {
    const w = wallet.trim();
    if (!w || !mainFinderLive(this.chain())) {
      this.stakeKind.set('');
      return;
    }
    try {
      const res = await this.transport({
        method: 'GET',
        path: `/v1/stake-preview?wallet=${encodeURIComponent(w)}`,
        chain: this.chain(),
      });
      const body = res.json as { kind?: string; title?: string };
      if (res.status >= 400) {
        this.stakeKind.set(body.title ?? 'stake preview failed');
        return;
      }
      this.stakeKind.set(body.kind ?? '');
    } catch {
      this.stakeKind.set('');
    }
  }

  protected async submitRegister(): Promise<void> {
    if (!this.liveTenant()) {
      this.notice.set('Main is not live. Dummy MAIN is not a registry tenant.');
      return;
    }
    this.error.set('');
    const v = this.form.getRawValue();
    if (!this.pendingRegister || !this.sparrowMessage()) {
      this.composeRegister();
      return;
    }
    const tip = this.tipFrom(v);
    const env = {
      messageVersion: 1,
      commandKind: 'registerListing' as const,
      chain: this.chain(),
      wallet: v.wallet.trim(),
      payloadHash: this.sparrowMessage(),
      signature: sparrowSignatureToBase64Url(v.signature),
      signingBlockHash: tip.signingBlockHash,
      signingBlockHeight: tip.signingBlockHeight,
    };
    const res = await this.transport({
      method: 'POST',
      path: '/v1/listings',
      chain: this.chain(),
      body: this.pendingRegister,
      authorization: envelopeAuthorization(env),
    });
    if (res.status >= 400) {
      const body = res.json as { title?: string };
      this.error.set(body.title ?? 'Register failed');
      return;
    }
    this.notice.set('Listing registered.');
    await this.reloadListings();
  }

  protected async submitAttest(): Promise<void> {
    if (!this.liveTenant()) {
      this.notice.set('Main is not live. Dummy MAIN is not a registry tenant.');
      return;
    }
    this.error.set('');
    if (!this.pendingAttest || !this.attestSparrowMessage()) {
      this.composeAttestCommand();
      return;
    }
    const v = this.attestForm.getRawValue();
    const height = Number.parseInt(v.coinbaseHeight, 10) || 0;
    const command = {
      commandKind: 'attestListing' as const,
      poolId: this.pendingAttest.poolId,
      height,
      connect: this.pendingAttest.connect,
    };
    const tip = this.tipFrom(v);
    const env = {
      messageVersion: 1,
      commandKind: 'attestListing' as const,
      chain: this.chain(),
      wallet: v.wallet.trim(),
      payloadHash: this.attestSparrowMessage(),
      signature: sparrowSignatureToBase64Url(v.signature),
      signingBlockHash: tip.signingBlockHash,
      signingBlockHeight: tip.signingBlockHeight,
    };
    const res = await this.transport({
      method: 'POST',
      path: `/v1/listings/${this.pendingAttest.poolId}/attestations`,
      chain: this.chain(),
      body: command,
      authorization: envelopeAuthorization(env),
    });
    if (res.status >= 400) {
      const body = res.json as { title?: string };
      this.error.set(body.title ?? 'Attest failed');
      return;
    }
    this.notice.set('Attestation recorded.');
    this.closeAttest();
    await this.reloadListings();
  }

  protected mineThis(p: ListingPublic): void {
    if (!this.canMineThis(p)) {
      this.notice.set('This listing has no Stratum advertise the mill can mine to.');
      return;
    }
    const chain = this.chain();
    if (this.shell.kind === 'desktop') {
      const c = p.connect;
      if (c.kind === 'datumOnly') {
        this.notice.set('Prime is set on your DATUM Gateway, not mill MineTo.');
        return;
      }
      applyDesktopStratumTarget(chain, c.stratum.host, c.stratum.port);
      this.nav.goMine();
      this.mining.warn(`Mine target set to ${c.stratum.host}:${c.stratum.port}. Open Mine and Start.`);
      return;
    }
    const url = listingStratumWssUrl(p.connect);
    if (!url) {
      this.notice.set('In-page mining needs a listing WSS advertise.');
      return;
    }
    applyWebPoolWssTarget(chain, url);
    this.nav.goMine();
    this.mining.warn(`Mine target set to ${url}. Open Mine and Start.`);
  }

  protected async testCpuShares(p: ListingPublic): Promise<void> {
    const wss = p.connect.wss;
    if (!wss) {
      this.notice.set('This listing has no WSS extra for a CPU share test.');
      return;
    }
    this.notice.set(`Share test WSS ${wss.host}${wss.path} is client-side only. The registry does not open it.`);
  }
}
