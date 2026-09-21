import { Component, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { MinerChain } from './chain';
import { WalletService } from './wallet.service';
import { isValidPhrase } from './wallet-derive';

@Component({
  selector: 'app-wallet-import',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div [formGroup]="form">
      <p class="hint">12 or 24 English BIP39 words.</p>
      <mat-form-field appearance="outline">
        <mat-label>Phrase</mat-label>
        <textarea matInput rows="3" formControlName="phrase"></textarea>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Password (wraps the stored seed)</mat-label>
        <input matInput type="password" formControlName="password" />
      </mat-form-field>
      <button mat-flat-button color="primary" type="button" (click)="save()">Import</button>
      @if (error()) {
        <p class="err">{{ error() }}</p>
      }
    </div>
  `,
})
export class WalletImport {
  readonly chain = input.required<MinerChain>();
  readonly done = output<void>();
  private readonly wallet = inject(WalletService);
  protected readonly error = signal('');
  protected readonly form = new FormGroup({
    phrase: new FormControl('', { nonNullable: true }),
    password: new FormControl('', { nonNullable: true }),
  });

  protected async save(): Promise<void> {
    this.error.set('');
    const v = this.form.getRawValue();
    if (!isValidPhrase(v.phrase)) {
      this.error.set('invalid phrase');
      return;
    }
    if (!v.password) {
      this.error.set('Password is required.');
      return;
    }
    try {
      await this.wallet.persistPhrase(v.phrase, v.password, this.chain());
      this.done.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
