import { Component, inject, input, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { MinerChain } from './chain';
import { WalletService } from './wallet.service';
import { createPhrase, isValidPhrase } from './wallet-derive';
import { phrasesEqual } from './wallet-crypto';
import { WordGrid } from './word-grid';

function wordControls(count: number): FormControl<string>[] {
  return Array.from({ length: count }, () => new FormControl('', { nonNullable: true }));
}

@Component({
  selector: 'app-wallet-create',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, WordGrid],
  styles: [
    `
      .phrase-region {
        min-height: 22rem;
      }
      mat-form-field {
        display: block;
        width: 100%;
        margin-top: 12px;
      }
      .row {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
    `,
  ],
  templateUrl: './wallet-create.html',
})
export class WalletCreate {
  readonly chain = input.required<MinerChain>();
  readonly wordCount = input.required<12 | 24>();
  readonly done = output<void>();
  private readonly wallet = inject(WalletService);
  protected readonly step = signal<'show' | 'confirm'>('show');
  protected readonly error = signal('');
  protected readonly shown = wordControls(24);
  protected readonly confirm = wordControls(24);
  protected readonly password = new FormControl('', { nonNullable: true });
  private phrase = '';

  protected shownWords(): FormControl<string>[] {
    return this.shown.slice(0, this.wordCount());
  }

  protected confirmWords(): FormControl<string>[] {
    return this.confirm.slice(0, this.wordCount());
  }

  protected generate(): void {
    this.error.set('');
    this.step.set('show');
    this.phrase = createPhrase(this.wordCount() === 24 ? 256 : 128);
    const parts = this.phrase.split(/\s+/);
    this.shownWords().forEach((ctrl, i) => ctrl.setValue(parts[i] ?? ''));
    this.confirmWords().forEach((ctrl) => ctrl.setValue(''));
    this.password.setValue('');
  }

  protected saved(): void {
    this.error.set('');
    if (!isValidPhrase(this.phrase)) {
      this.error.set('Generate words first.');
      return;
    }
    this.step.set('confirm');
  }

  protected back(): void {
    this.step.set('show');
    this.error.set('');
  }

  protected async save(): Promise<void> {
    this.error.set('');
    const typed = this.confirmWords()
      .map((c) => c.value)
      .join(' ');
    if (!phrasesEqual(this.phrase, typed)) {
      this.error.set('Re-enter does not match. Nothing was saved.');
      return;
    }
    if (!this.password.value) {
      this.error.set('Password is required.');
      return;
    }
    try {
      await this.wallet.persistPhrase(this.phrase, this.password.value, this.chain());
      this.done.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}

@Component({
  selector: 'app-wallet-create-12',
  imports: [WalletCreate],
  template: `<app-wallet-create [chain]="chain()" [wordCount]="12" (done)="done.emit()" />`,
})
export class WalletCreate12 {
  readonly chain = input.required<MinerChain>();
  readonly done = output<void>();
}

@Component({
  selector: 'app-wallet-create-24',
  imports: [WalletCreate],
  template: `<app-wallet-create [chain]="chain()" [wordCount]="24" (done)="done.emit()" />`,
})
export class WalletCreate24 {
  readonly chain = input.required<MinerChain>();
  readonly done = output<void>();
}
