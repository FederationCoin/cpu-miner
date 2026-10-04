import { Component, inject, input, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { MinerChain } from './chain';
import { WalletService } from './wallet.service';
import { isValidPhrase, type ReceiveKind } from './wallet-derive';
import { SECP_WARNING } from './wallet-secp';
import { WordGrid } from './word-grid';

function wordControls(count: number): FormControl<string>[] {
  return Array.from({ length: count }, () => new FormControl('', { nonNullable: true }));
}

@Component({
  selector: 'app-wallet-import',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, WordGrid],
  styles: [
    `
      mat-form-field {
        display: block;
        width: 100%;
        margin-top: 12px;
      }
    `,
  ],
  template: `
    <p class="hint">{{ wordCount() }} English BIP39 words. Paste is blocked.</p>
    <app-word-grid [words]="activeBoxes()" />
    <mat-form-field appearance="outline">
      <mat-label>Receive kind</mat-label>
      <mat-select [formControl]="kind">
        <mat-option value="mldsa87">Dilithium 87</mat-option>
        <mat-option value="mldsa44">Dilithium 44</mat-option>
        <mat-option value="secp">secp (cheap-out)</mat-option>
      </mat-select>
    </mat-form-field>
    @if (kind.value === 'secp') {
      <p class="err">{{ secpWarning }}</p>
    }
    <mat-form-field appearance="outline">
      <mat-label>Password (wraps the stored seed)</mat-label>
      <input matInput type="password" [formControl]="password" />
    </mat-form-field>
    <button mat-flat-button color="primary" type="button" (click)="save()">Import</button>
    @if (error()) {
      <p class="err">{{ error() }}</p>
    }
  `,
})
export class WalletImport {
  readonly chain = input.required<MinerChain>();
  readonly wordCount = input<12 | 24>(12);
  readonly done = output<void>();
  private readonly wallet = inject(WalletService);
  protected readonly error = signal('');
  protected readonly boxes = wordControls(24);
  protected readonly password = new FormControl('', { nonNullable: true });
  protected readonly kind = new FormControl<ReceiveKind>('mldsa87', { nonNullable: true });
  protected readonly secpWarning = SECP_WARNING;

  protected activeBoxes(): FormControl<string>[] {
    return this.boxes.slice(0, this.wordCount());
  }

  protected async save(): Promise<void> {
    this.error.set('');
    const phrase = this.boxes
      .slice(0, this.wordCount())
      .map((c) => c.value)
      .join(' ');
    if (!isValidPhrase(phrase)) {
      this.error.set('invalid phrase');
      return;
    }
    if (!this.password.value) {
      this.error.set('Password is required.');
      return;
    }
    try {
      await this.wallet.persistPhrase(phrase, this.password.value, this.chain(), this.kind.value);
      this.done.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
