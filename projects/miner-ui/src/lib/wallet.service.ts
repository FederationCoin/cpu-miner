import { Injectable, inject, signal } from '@angular/core';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import type { MinerChain } from './chain';
import { unwrapSeed, wrapSeed } from './wallet-crypto';
import { derivePrivateKey, deriveReceive, isValidPhrase, seedFromPhrase } from './wallet-derive';
import { signElectrum } from './electrum-sign';
import { newWalletId, parseWalletStore, storeWasList, type WalletRecord, type WalletStoreFile } from './wallet-file';

export const WALLET_LOCK_MS = 5 * 60 * 1000;
const LOCK_MS = WALLET_LOCK_MS;
const IDENTITY_WALLET_KEY = 'fc.identity.wallet';

export type WalletView =
  | { kind: 'empty' }
  | { kind: 'watchOnly'; receive: string }
  | { kind: 'locked'; receive: string }
  | { kind: 'unlocked'; receive: string };

export type WalletRow = { id: string; receive: string; unlocked: boolean };

const EMPTY_STORE: WalletStoreFile = { wallets: [], selectedId: '', mineToId: '' };

@Injectable({ providedIn: 'root' })
export class WalletService {
  private readonly host = inject(HASHER_HOST);
  private readonly shell = inject(MINER_SHELL);
  readonly view = signal<WalletView>({ kind: 'empty' });
  readonly receive = signal('');
  readonly entries = signal<WalletRow[]>([]);
  readonly selectedId = signal('');
  readonly mineToId = signal('');
  readonly mineToRequest = signal<string | null>(null);
  private seed: Uint8Array | null = null;
  private unlockAt = 0;
  private unlockedId = '';
  private store: WalletStoreFile = EMPTY_STORE;
  private chain: MinerChain = 'testnet';
  private loadedChain: MinerChain | null = null;

  async load(chain: MinerChain): Promise<void> {
    if (this.loadedChain === chain) {
      return;
    }
    this.clearSeed();
    this.chain = chain;
    this.loadedChain = chain;
    const raw = await this.readRaw(chain);
    const parsed = raw ? parseWalletStore(raw) : null;
    if (parsed && raw && !storeWasList(raw)) {
      await this.writeRaw(chain, JSON.stringify(parsed));
    }
    this.store = parsed ?? { ...EMPTY_STORE, wallets: [] };
    if (!this.store.wallets.length) {
      this.selectedId.set('');
      this.mineToId.set('');
      this.entries.set([]);
      const leftover = localStorage.getItem(IDENTITY_WALLET_KEY)?.trim() ?? '';
      if (leftover) {
        this.receive.set(leftover);
        this.view.set({ kind: 'watchOnly', receive: leftover });
        return;
      }
      this.receive.set('');
      this.view.set({ kind: 'empty' });
      return;
    }
    if (!this.store.wallets.some((w) => w.id === this.store.selectedId)) {
      this.store.selectedId = this.store.wallets[0].id;
    }
    if (this.store.mineToId && !this.store.wallets.some((w) => w.id === this.store.mineToId)) {
      this.store.mineToId = '';
    }
    this.publish();
  }

  lock(): void {
    this.clearSeed();
    this.publish();
  }

  select(id: string): void {
    if (!this.store.wallets.some((w) => w.id === id)) {
      return;
    }
    if (this.unlockedId && this.unlockedId !== id) {
      this.clearSeed();
    }
    this.store.selectedId = id;
    this.publish();
    void this.persist();
  }

  async unlock(password: string): Promise<void> {
    const rec = this.selected();
    if (!rec) {
      throw new Error('no keystore');
    }
    await this.unlockRecord(rec, password);
  }

  async checkPassword(id: string, password: string): Promise<void> {
    const rec = this.byId(id);
    if (!rec) {
      throw new Error('no keystore');
    }
    const seed = await unwrapSeed(rec.blob, password);
    seed.fill(0);
  }

  assignMineTo(id: string): void {
    const rec = this.byId(id);
    if (!rec) {
      return;
    }
    this.store.mineToId = id;
    this.mineToId.set(id);
    this.mineToRequest.set(rec.blob.receive);
    this.publish();
    void this.persist();
  }

  requestMineTo(): void {
    const id = this.selectedId();
    if (id) {
      this.assignMineTo(id);
    }
  }

  notePayout(addr: string): void {
    const id = this.store.mineToId;
    if (!id) {
      return;
    }
    const rec = this.byId(id);
    if (!rec || rec.blob.receive === addr.trim()) {
      return;
    }
    this.store.mineToId = '';
    this.mineToId.set('');
    void this.persist();
  }

  selectedReceive(): string {
    return this.selected()?.blob.receive ?? '';
  }

  private async unlockRecord(rec: WalletRecord, password: string): Promise<void> {
    this.seed = await unwrapSeed(rec.blob, password);
    this.unlockedId = rec.id;
    this.unlockAt = Date.now();
    this.publish();
  }

  private ensureUnlocked(): Uint8Array {
    if (!this.seed || Date.now() - this.unlockAt > LOCK_MS) {
      this.lock();
      throw new Error('wallet is locked');
    }
    this.unlockAt = Date.now();
    return this.seed;
  }

  async persistPhrase(phrase: string, password: string, chain: MinerChain): Promise<void> {
    if (!isValidPhrase(phrase)) {
      throw new Error('invalid phrase');
    }
    if (this.loadedChain !== chain) {
      await this.load(chain);
    }
    const seed = seedFromPhrase(phrase);
    const receive = deriveReceive(seed, chain);
    const blob = await wrapSeed(seed, password, receive);
    const id = newWalletId();
    this.store.wallets = [...this.store.wallets, { id, blob }];
    this.store.selectedId = id;
    this.chain = chain;
    this.loadedChain = chain;
    this.seed = seed;
    this.unlockedId = id;
    this.unlockAt = Date.now();
    await this.persist();
    this.publish();
  }

  signMessage(message: string): string {
    const seed = this.ensureUnlocked();
    return signElectrum(message, derivePrivateKey(seed, this.chain));
  }

  chipLabel(): string {
    const a = this.receive();
    if (!a) {
      return '';
    }
    if (a.length < 16) {
      return a;
    }
    return `${a.slice(0, 8)}…${a.slice(-6)}`;
  }

  isWeb(): boolean {
    return this.shell.kind === 'webDemo';
  }

  private selected(): WalletRecord | undefined {
    return this.byId(this.store.selectedId);
  }

  private byId(id: string): WalletRecord | undefined {
    return this.store.wallets.find((w) => w.id === id);
  }

  private publish(): void {
    this.entries.set(
      this.store.wallets.map((w) => ({
        id: w.id,
        receive: w.blob.receive,
        unlocked: w.id === this.unlockedId && !!this.seed,
      })),
    );
    this.selectedId.set(this.store.selectedId);
    this.mineToId.set(this.store.mineToId);
    const sel = this.selected();
    if (!sel) {
      if (this.view().kind === 'watchOnly') {
        return;
      }
      this.receive.set('');
      this.view.set({ kind: 'empty' });
      return;
    }
    this.receive.set(sel.blob.receive);
    const unlocked = this.unlockedId === sel.id && !!this.seed;
    this.view.set(unlocked ? { kind: 'unlocked', receive: sel.blob.receive } : { kind: 'locked', receive: sel.blob.receive });
  }

  private clearSeed(): void {
    if (this.seed) {
      this.seed.fill(0);
    }
    this.seed = null;
    this.unlockAt = 0;
    this.unlockedId = '';
  }

  private async persist(): Promise<void> {
    await this.writeRaw(this.chain, JSON.stringify(this.store));
  }

  private async readRaw(chain: MinerChain): Promise<string | null> {
    if (this.shell.kind === 'desktop' && this.host.walletLoad) {
      return this.host.walletLoad(chain);
    }
    return localStorage.getItem(`fc.keystore.${chain}`);
  }

  private async writeRaw(chain: MinerChain, blob: string): Promise<void> {
    if (this.shell.kind === 'desktop' && this.host.walletSave) {
      const r = await this.host.walletSave(chain, blob);
      if (!r.ok) {
        throw new Error(r.error ?? 'save failed');
      }
      return;
    }
    localStorage.setItem(`fc.keystore.${chain}`, blob);
  }
}
