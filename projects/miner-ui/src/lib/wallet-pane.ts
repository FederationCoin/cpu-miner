import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import type { MinerChain } from './chain';
import { MINER_SHELL } from './miner-shell';
import { NetworkContext } from './network-context';
import { WalletService } from './wallet.service';
import { WalletCreate12, WalletCreate24 } from './wallet-create';
import { WalletImport } from './wallet-import';

type WalletPath = 'home' | 'create12' | 'create24' | 'import12' | 'import24';
type UnlockAsk = { id: string; purpose: 'session' | 'mine' };

@Component({
  selector: 'app-wallet-pane',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    WalletCreate12,
    WalletCreate24,
    WalletImport,
  ],
  templateUrl: './wallet-pane.html',
  styleUrl: './wallet-pane.css',
  host: { '[attr.data-chain]': 'chain()' },
})
export class WalletPane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  protected readonly wallet = inject(WalletService);
  private readonly network = inject(NetworkContext);
  protected readonly path = signal<WalletPath>('home');
  protected readonly error = signal('');
  protected readonly pendingMine = signal<string | null>(null);
  protected readonly unlockAsk = signal<UnlockAsk | null>(null);
  protected readonly password = new FormControl('', { nonNullable: true });

  constructor() {
    effect(() => {
      if (this.chain() !== this.network.chain()) {
        return;
      }
      void this.wallet.load(this.chain());
    });
  }

  ngOnInit(): void {
    if (this.chain() === this.network.chain()) {
      void this.wallet.load(this.chain());
    }
  }

  protected isWeb(): boolean {
    return this.shell.kind === 'webDemo';
  }

  protected select(id: string): void {
    this.wallet.select(id);
  }

  protected async submitPassword(): Promise<void> {
    const ask = this.unlockAsk();
    if (!ask) {
      return;
    }
    this.error.set('');
    try {
      if (ask.purpose === 'session') {
        this.wallet.select(ask.id);
        await this.wallet.unlock(this.password.value);
        this.unlockAsk.set(null);
        this.password.setValue('');
        return;
      }
      await this.wallet.checkPassword(ask.id, this.password.value);
      this.unlockAsk.set(null);
      this.password.setValue('');
      this.pendingMine.set(ask.id);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected beginMine(id: string, unlocked: boolean): void {
    this.error.set('');
    if (!unlocked) {
      this.unlockAsk.set({ id, purpose: 'mine' });
      return;
    }
    this.pendingMine.set(id);
  }

  protected confirmMineTo(): void {
    const id = this.pendingMine();
    if (id) {
      this.wallet.assignMineTo(id);
    }
    this.pendingMine.set(null);
  }
}
