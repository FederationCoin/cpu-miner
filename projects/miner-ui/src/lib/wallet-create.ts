import { Component, Directive, OnInit, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import type { MinerChain } from './chain';
import { WalletService } from './wallet.service';
import { createPhrase, isValidPhrase } from './wallet-derive';
import { phrasesEqual } from './wallet-crypto';

@Directive()
export abstract class WalletCreateBase implements OnInit {
  readonly chain = input.required<MinerChain>();
  readonly done = output<void>();
  protected readonly wallet = inject(WalletService);
  protected readonly phrase = signal('');
  protected readonly error = signal('');
  protected readonly form = new FormGroup({
    saved: new FormControl(false, { nonNullable: true }),
    reenter: new FormControl('', { nonNullable: true }),
    password: new FormControl('', { nonNullable: true }),
  });
  protected abstract readonly strength: 128 | 256;
  protected abstract readonly wordCount: 12 | 24;

  ngOnInit(): void {
    this.phrase.set(createPhrase(this.strength));
  }

  protected async save(): Promise<void> {
    this.error.set('');
    const v = this.form.getRawValue();
    if (!v.saved) {
      this.error.set('Save the words first.');
      return;
    }
    if (!phrasesEqual(this.phrase(), v.reenter)) {
      this.error.set('Re-enter does not match. Nothing was saved.');
      return;
    }
    if (!isValidPhrase(this.phrase())) {
      this.error.set('invalid phrase');
      return;
    }
    if (!v.password) {
      this.error.set('Password is required.');
      return;
    }
    try {
      await this.wallet.persistPhrase(this.phrase(), v.password, this.chain());
      this.done.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}

@Component({
  selector: 'app-wallet-create-12',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatCheckboxModule],
  templateUrl: './wallet-create.html',
})
export class WalletCreate12 extends WalletCreateBase {
  protected readonly strength = 128 as const;
  protected readonly wordCount = 12 as const;
}

@Component({
  selector: 'app-wallet-create-24',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatCheckboxModule],
  templateUrl: './wallet-create.html',
})
export class WalletCreate24 extends WalletCreateBase {
  protected readonly strength = 256 as const;
  protected readonly wordCount = 24 as const;
}
