import { Component, DestroyRef, ElementRef, NgZone, effect, inject, input, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime } from 'rxjs';
import type { MinerChain } from './chain';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import { MiningService } from './mining.service';
import { formatStakeGfCn } from './miner-format';
import { applyDesktopStratumTarget, applyWebPoolWssTarget } from './mine-target';
import { WorkspaceNav } from './workspace-nav';
import {
  ConnectionKindLabel,
  ConnectionKindPlaceholder,
  RegisterConnectionKinds,
  MaxPoolConnections,
  MaxPoolConnectionsPerKind,
  canAddPoolConnection,
  connectionEquals,
  envelopeAuthorization,
  listingCanMineThis,
  listingConnections,
  listingMineUrl,
  listingPrimeConnections,
  mainFinderLive,
  registryFetch,
  signedPayloadHash,
  sparrowSignatureToBase64Url,
  splitHostPort,
  type ConnectionKind,
  type FindGroup,
  type ListingPublic,
  type PoolConnection,
  type RegistryRequest,
} from './registry';

const IDENTITY_WALLET_KEY = 'fc.identity.wallet';
const IDENTITY_ENVELOPE_KEY = 'fc.identity.envelope';
const ATTESTED_KEY = 'fc.attested';

type AttestedMap = Record<string, PoolConnection>;

function connectionGroup(kind: ConnectionKind = 'stratum', url = ''): FormGroup<{
  kind: FormControl<ConnectionKind>;
  url: FormControl<string>;
}> {
  return new FormGroup({
    kind: new FormControl<ConnectionKind>(kind, { nonNullable: true }),
    url: new FormControl(url, { nonNullable: true }),
  });
}

function loadAttested(): AttestedMap {
  try {
    const raw = localStorage.getItem(ATTESTED_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as AttestedMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

@Component({
  selector: 'app-finder-pane',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
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
  protected readonly stakeGfCn = signal('…');
  protected readonly stakeTooltip = signal('Load a tip to see the HODL amount.');
  protected readonly holdBlocks = signal(0);
  protected readonly identityWallet = signal(localStorage.getItem(IDENTITY_WALLET_KEY)?.trim() ?? '');
  protected readonly attested = signal<AttestedMap>(loadAttested());
  readonly listingKinds = RegisterConnectionKinds;
  protected readonly kindLabel = ConnectionKindLabel;
  protected readonly maxConnections = MaxPoolConnections;
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    websiteUrl: new FormControl('', { nonNullable: true }),
    coinbaseTag: new FormControl('', { nonNullable: true }),
    connections: new FormArray([connectionGroup()]),
    confirmPayee: new FormControl(false, { nonNullable: true }),
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
  private pendingAttest: { poolId: string; connect: PoolConnection } | undefined;

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

  protected connectionArray(): FormArray {
    return this.form.controls.connections;
  }

  protected connectionValues(): PoolConnection[] {
    return this.connectionArray().controls.map((c) => {
      const g = c as FormGroup;
      return {
        kind: g.controls['kind'].value as ConnectionKind,
        url: String(g.controls['url'].value ?? '').trim(),
      };
    });
  }

  protected placeholderFor(row: { get: (n: string) => { value: unknown } | null }): string {
    const kind = row.get('kind')?.value;
    if (kind === 'stratum' || kind === 'stratumWs' || kind === 'datumPrime' || kind === 'datumPrimeWs') {
      return ConnectionKindPlaceholder[kind];
    }
    return ConnectionKindPlaceholder.stratum;
  }

  protected kindCount(kind: ConnectionKind): number {
    return this.connectionValues().filter((c) => c.kind === kind).length;
  }

  protected kindOptionDisabled(kind: ConnectionKind, index: number): boolean {
    const current = this.connectionValues()[index]?.kind;
    if (current === kind) {
      return false;
    }
    return this.kindCount(kind) >= MaxPoolConnectionsPerKind;
  }

  protected canAddConnection(): boolean {
    return RegisterConnectionKinds.some((k) => canAddPoolConnection(this.connectionValues(), k));
  }

  protected addConnection(): void {
    const next = RegisterConnectionKinds.find((k) => canAddPoolConnection(this.connectionValues(), k));
    if (!next) {
      return;
    }
    this.connectionArray().push(connectionGroup(next));
  }

  protected removeConnection(i: number): void {
    if (this.connectionArray().length <= 1) {
      return;
    }
    this.connectionArray().removeAt(i);
  }

  protected connectionsOf(p: ListingPublic): PoolConnection[] {
    return listingConnections(p);
  }

  protected primesOf(p: ListingPublic): PoolConnection[] {
    return listingPrimeConnections(p);
  }

  protected canMineThis(p: ListingPublic): boolean {
    return listingCanMineThis(p, this.shell.kind === 'webDemo');
  }

  protected stampState(p: ListingPublic, c: PoolConnection): 'login' | 'done' | 'attest' | 'hidden' {
    if (!this.identityWallet()) {
      return 'login';
    }
    const hit = this.attested()[p.poolId] ?? p.attestedByYou;
    if (hit) {
      return connectionEquals(hit, c) ? 'done' : 'hidden';
    }
    return 'attest';
  }

  protected stampId(p: ListingPublic, c: PoolConnection): string {
    return this.id(`attest-${c.kind}-${p.poolId}`);
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

  private identityAuth(): string | undefined {
    return localStorage.getItem(IDENTITY_ENVELOPE_KEY) || undefined;
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
      const res = await this.transport({
        method: 'GET',
        path,
        chain: this.chain(),
        authorization: this.identityAuth(),
      });
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
      this.mergeRemoteAttestations(items.length ? items : (body.groups ?? []).flatMap((g) => g.listings));
      this.notice.set('');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Find failed');
      this.groups.set([]);
    }
  }

  private mergeRemoteAttestations(items: ListingPublic[]): void {
    const next = { ...this.attested() };
    let changed = false;
    for (const p of items) {
      if (p.attestedByYou) {
        next[p.poolId] = p.attestedByYou;
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(ATTESTED_KEY, JSON.stringify(next));
      this.attested.set(next);
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
        holdBlocks?: number;
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
      const shown = body.stakeRequiredSats ? formatStakeGfCn(body.stakeRequiredSats) : '';
      this.stakeGfCn.set(shown || '…');
      const hold = body.holdBlocks ?? 0;
      this.holdBlocks.set(hold);
      if (hold > 0) {
        this.stakeTooltip.set(
          `You are not sending coin. ${shown || 'This'} GFCN must sit in the wallet for ${hold} blocks before the signing block, without dipping.`,
        );
      } else {
        this.stakeTooltip.set(
          `You are not sending coin. ${shown || 'This'} GFCN must be in the wallet at sign time (anti-spam). Open season: balance only.`,
        );
      }
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
    return listingConnections(p)
      .map((c) => `${ConnectionKindLabel[c.kind]} ${c.url}`)
      .join(' · ');
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

  protected canSubmitListing(): boolean {
    const v = this.form.getRawValue();
    return (
      this.liveTenant() &&
      !!this.sparrowMessage() &&
      v.signature.trim().length > 0 &&
      v.wallet.trim().length > 0 &&
      this.stakeKind() === 'stakeReady' &&
      this.connectionValues().some((c) => c.url.length > 0)
    );
  }

  protected composeRegister(): void {
    if (!this.liveTenant()) {
      this.notice.set('Main is not live. Dummy MAIN is not a registry tenant.');
      return;
    }
    this.error.set('');
    const v = this.form.getRawValue();
    const connections = this.connectionValues().filter((c) => c.url.length > 0);
    if (connections.length < 1) {
      this.notice.set('Add at least one connection.');
      return;
    }
    const command = {
      commandKind: 'registerListing',
      name: v.name.trim(),
      websiteUrl: v.websiteUrl.trim(),
      coinbaseTag: v.coinbaseTag.trim(),
      connections,
      listerConfirmedCoinbasePayee: v.confirmPayee,
    };
    const tip = this.tipFrom(v);
    const hash = signedPayloadHash(command, tip.signingBlockHeight, tip.signingBlockHash);
    this.pendingRegister = command;
    this.commandJson.set(JSON.stringify({ command, ...tip }, null, 2));
    this.sparrowMessage.set(hash);
    this.notice.set(
      'Copy the 64-hex message below into federation-sparrow Sign/Verify. Format is Electrum Format. Sign with the listing P2WPKH wallet, then paste the signature.',
    );
  }

  protected openAttest(p: ListingPublic, c: PoolConnection): void {
    if (this.stampState(p, c) !== 'attest') {
      return;
    }
    this.pendingAttest = { poolId: p.poolId, connect: c };
    this.attestSummary.set(`Attest ${ConnectionKindLabel[c.kind]} ${c.url} on ${p.name}`);
    this.attestCommandJson.set('');
    this.attestSparrowMessage.set('');
    this.attestForm.controls.signature.setValue('');
    if (this.identityWallet()) {
      this.attestForm.controls.wallet.setValue(this.identityWallet());
    }
    void this.fillSignContext();
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
      this.notice.set('Pick a stamp on a listing connection first.');
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
      'Copy the attest 64-hex message into federation-sparrow Sign/Verify. Format is Electrum Format. Sign with the attester P2WPKH wallet, then paste the signature.',
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

  private rememberIdentity(wallet: string, authorization: string): void {
    localStorage.setItem(IDENTITY_WALLET_KEY, wallet);
    localStorage.setItem(IDENTITY_ENVELOPE_KEY, authorization);
    this.identityWallet.set(wallet);
  }

  private rememberAttest(poolId: string, connect: PoolConnection): void {
    const next = { ...this.attested(), [poolId]: connect };
    localStorage.setItem(ATTESTED_KEY, JSON.stringify(next));
    this.attested.set(next);
  }

  protected async submitRegister(): Promise<void> {
    if (!this.liveTenant()) {
      this.notice.set('Main is not live. Dummy MAIN is not a registry tenant.');
      return;
    }
    this.error.set('');
    if (!this.canSubmitListing()) {
      this.notice.set('Need a qualifying tip, stake preview, and Electrum Format signature.');
      return;
    }
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
    const authorization = envelopeAuthorization(env);
    const res = await this.transport({
      method: 'POST',
      path: '/v1/listings',
      chain: this.chain(),
      body: this.pendingRegister,
      authorization,
    });
    if (res.status >= 400) {
      const body = res.json as { title?: string };
      this.error.set(body.title ?? 'Register failed');
      return;
    }
    this.rememberIdentity(env.wallet, authorization);
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
    const authorization = envelopeAuthorization(env);
    const res = await this.transport({
      method: 'POST',
      path: `/v1/listings/${this.pendingAttest.poolId}/attestations`,
      chain: this.chain(),
      body: command,
      authorization,
    });
    if (res.status >= 400) {
      const body = res.json as { title?: string };
      this.error.set(body.title ?? 'Attest failed');
      return;
    }
    this.rememberIdentity(env.wallet, authorization);
    this.rememberAttest(command.poolId, command.connect);
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
    const url = listingMineUrl(p, this.shell.kind === 'webDemo');
    if (!url) {
      this.notice.set('This listing has no Stratum advertise the mill can mine to.');
      return;
    }
    if (this.shell.kind === 'desktop') {
      const hp = splitHostPort(url);
      if (!hp) {
        this.notice.set('Stratum host is not host:port.');
        return;
      }
      applyDesktopStratumTarget(chain, hp.host, hp.port);
      this.nav.goMine();
      this.mining.warn(`Mine target set to ${hp.host}:${hp.port}. Open Mine and Start.`);
      return;
    }
    applyWebPoolWssTarget(chain, url);
    this.nav.goMine();
    this.mining.warn(`Mine target set to ${url}. Open Mine and Start.`);
  }

  protected async testCpuShares(p: ListingPublic): Promise<void> {
    const wss = listingConnections(p).find((c) => c.kind === 'stratumWs');
    if (!wss) {
      this.notice.set('This listing has no WSS extra for a CPU share test.');
      return;
    }
    this.notice.set(`Share test WSS ${wss.url} is client-side only. The registry does not open it.`);
  }
}
