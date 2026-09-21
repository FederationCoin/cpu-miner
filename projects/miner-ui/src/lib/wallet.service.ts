import { Injectable, inject, signal } from '@angular/core';
import { HASHER_HOST } from './hasher-host';
import { MINER_SHELL } from './miner-shell';
import type { MinerChain } from './chain';
import { parseBlob, unwrapSeed, wrapSeed, type KeystoreBlob } from './wallet-crypto';
import { derivePrivateKey, deriveReceive, isValidPhrase, seedFromPhrase } from './wallet-derive';
import { signElectrum } from './electrum-sign';

export const WALLET_LOCK_MS = 5 * 60 * 1000;
const LOCK_MS = WALLET_LOCK_MS;
const IDENTITY_WALLET_KEY = 'fc.identity.wallet';

export type WalletView =
  | { kind: 'empty' }
  | { kind: 'watchOnly'; receive: string }
  | { kind: 'locked'; receive: string }
  | { kind: 'unlocked'; receive: string };

@Injectable({ providedIn: 'root' })
export class WalletService {
  private readonly host = inject(HASHER_HOST);
  private readonly shell = inject(MINER_SHELL);
  readonly view = signal<WalletView>({ kind: 'empty' });
  readonly receive = signal('');
  readonly mineToRequest = signal<string | null>(null);
  private seed: Uint8Array | null = null;
  private unlockAt = 0;
  private blob: KeystoreBlob | null = null;
  private chain: MinerChain = 'testnet';

  async load(chain: MinerChain): Promise<void> {
    if (this.chain === chain && this.blob) {
      return;
    }
    this.lock();
    this.chain = chain;
    const raw = await this.readRaw(chain);
    const parsed = raw ? parseBlob(raw) : null;
    this.blob = parsed;
    if (parsed) {
      this.receive.set(parsed.receive);
      this.view.set({ kind: 'locked', receive: parsed.receive });
      return;
    }
    const leftover = localStorage.getItem(IDENTITY_WALLET_KEY)?.trim() ?? '';
    if (leftover) {
      this.receive.set(leftover);
      this.view.set({ kind: 'watchOnly', receive: leftover });
      return;
    }
    this.receive.set('');
    this.view.set({ kind: 'empty' });
  }

  lock(): void {
    this.seed = null;
    this.unlockAt = 0;
    if (this.blob) {
      this.view.set({ kind: 'locked', receive: this.blob.receive });
    }
  }

  private ensureUnlocked(): Uint8Array {
    if (!this.seed || Date.now() - this.unlockAt > LOCK_MS) {
      this.lock();
      throw new Error('wallet is locked');
    }
    this.unlockAt = Date.now();
    return this.seed;
  }

  async unlock(password: string): Promise<void> {
    if (!this.blob) {
      throw new Error('no keystore');
    }
    this.seed = await unwrapSeed(this.blob, password);
    this.unlockAt = Date.now();
    this.view.set({ kind: 'unlocked', receive: this.blob.receive });
  }

  async persistPhrase(phrase: string, password: string, chain: MinerChain): Promise<void> {
    if (!isValidPhrase(phrase)) {
      throw new Error('invalid phrase');
    }
    const seed = seedFromPhrase(phrase);
    const receive = deriveReceive(seed, chain);
    const blob = await wrapSeed(seed, password, receive);
    await this.writeRaw(chain, JSON.stringify(blob));
    this.blob = blob;
    this.seed = seed;
    this.unlockAt = Date.now();
    this.chain = chain;
    this.receive.set(receive);
    this.view.set({ kind: 'unlocked', receive });
  }

  signMessage(message: string): string {
    const seed = this.ensureUnlocked();
    const priv = derivePrivateKey(seed, this.chain);
    return signElectrum(message, priv);
  }

  requestMineTo(): void {
    const addr = this.receive();
    if (addr) {
      this.mineToRequest.set(addr);
    }
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
