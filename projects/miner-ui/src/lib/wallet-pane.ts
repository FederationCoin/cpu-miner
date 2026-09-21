import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { MinerChain } from './chain';
import { MINER_SHELL } from './miner-shell';
import { WalletService } from './wallet.service';
import { WalletCreate12, WalletCreate24 } from './wallet-create';
import { WalletImport } from './wallet-import';

type WalletPath = 'home' | 'create12' | 'create24' | 'import';

@Component({
  selector: 'app-wallet-pane',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    WalletCreate12,
    WalletCreate24,
    WalletImport,
  ],
  templateUrl: './wallet-pane.html',
  host: { '[attr.data-chain]': 'chain()' },
})
export class WalletPane implements OnInit {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  protected readonly wallet = inject(WalletService);
  protected readonly path = signal<WalletPath>('home');
  protected readonly error = signal('');
  protected readonly pendingMine = signal(false);
  protected readonly unlockForm = new FormGroup({
    password: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      void this.wallet.load(this.chain());
    });
  }

  ngOnInit(): void {
    void this.wallet.load(this.chain());
  }

  protected isWeb(): boolean {
    return this.shell.kind === 'webDemo';
  }

  protected async unlock(): Promise<void> {
    this.error.set('');
    try {
      await this.wallet.unlock(this.unlockForm.controls.password.value);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected requestMineTo(): void {
    this.pendingMine.set(true);
  }

  protected confirmMineTo(): void {
    this.wallet.requestMineTo();
    this.pendingMine.set(false);
  }
}
