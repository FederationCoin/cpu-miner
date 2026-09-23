import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CHAINS, type MinerChain } from './chain';
import { RpcConnect, type RpcConnectForm } from './rpc-connect';
import { DefaultsFold } from './defaults-fold';
import { HOUSE_HINTS } from './house-hints';

@Component({
  selector: 'app-desktop-mine-to',
  imports: [ReactiveFormsModule, MatButtonModule, MatRadioModule, MatFormFieldModule, MatInputModule, RpcConnect, DefaultsFold],
  styles: [
    `
      mat-radio-group {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
      mat-form-field {
        display: block;
        width: 100%;
        margin-top: 12px;
      }
      .pull {
        margin: 8px 0 12px;
      }
    `,
  ],
  template: `
    <div [formGroup]="form()">
      <mat-radio-group formControlName="kind" [attr.aria-label]="'Mine to'">
        <mat-radio-button [id]="id('mineToNode')" value="node" [disabled]="kindLocked()">Node RPC</mat-radio-button>
        <mat-radio-button [id]="id('mineToStratum')" value="stratum" [disabled]="kindLocked()">Stratum</mat-radio-button>
        <mat-radio-button [id]="id('mineToDatumGateway')" value="datumGateway" [disabled]="kindLocked()">DATUM Gateway</mat-radio-button>
      </mat-radio-group>
      @if (kind() === 'stratum') {
        <p class="hint">
          Hasher-to-gateway is Stratum v1. You may point this at a DATUM Gateway that is reachable.
          Authorize password is <code>x</code>.
        </p>
      }
      @switch (kind()) {
        @case ('node') {
          @if (rpcCookie()) {
            <app-defaults-fold [foldId]="id('rpc-fold')" title="Node RPC" [summary]="rpcSummary()">
              <app-rpc-connect [form]="rpcForm()" [idPrefix]="chain()" [chain]="chain()" />
            </app-defaults-fold>
          } @else {
            <fieldset class="partition">
              <legend>Node RPC</legend>
              <app-rpc-connect [form]="rpcForm()" [idPrefix]="chain()" [chain]="chain()" />
            </fieldset>
          }
          <mat-form-field appearance="outline">
            <mat-label>Payout address</mat-label>
            <input matInput [id]="id('payout')" type="text" autocomplete="off" spellcheck="false" [placeholder]="hrp() + '1…'" formControlName="payout" />
            <mat-hint>{{ hints.rpcTestnet }}</mat-hint>
          </mat-form-field>
          <button mat-stroked-button class="pull" type="button" [id]="id('pull-selected')" (click)="pull.emit()">Set to currently selected default</button>
        }
        @case ('stratum') {
          <div class="mine-fields" formGroupName="stratum">
            <mat-form-field appearance="outline">
              <mat-label>Host</mat-label>
              <input matInput [id]="id('stratumHost')" type="text" formControlName="host" />
              <mat-hint>stratum.testnet.federationcoin.org:23334</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Port</mat-label>
              <input matInput [id]="id('stratumPort')" type="number" formControlName="port" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Worker</mat-label>
              <input matInput [id]="id('stratumWorker')" type="text" [placeholder]="hrp() + '1….cpu'" formControlName="worker" />
            </mat-form-field>
            <p class="hint">Username as on firmware. A <code>.worker</code> suffix is allowed.</p>
            <button mat-stroked-button class="pull" type="button" [id]="id('pull-selected-stratum')" (click)="pull.emit()">Set to currently selected default</button>
            <mat-form-field appearance="outline">
              <mat-label>Password</mat-label>
              <input matInput [id]="id('stratumPassword')" type="password" formControlName="password" />
            </mat-form-field>
          </div>
        }
        @case ('datumGateway') {
          <p class="hint">Hasher speaks Stratum v1 to your local gateway. Password is <code>x</code>.</p>
          <div class="mine-fields" formGroupName="gateway">
            <mat-form-field appearance="outline">
              <mat-label>Host</mat-label>
              <input matInput [id]="id('gatewayHost')" type="text" formControlName="host" />
              <mat-hint>{{ hints.gatewayTcp }}</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Port</mat-label>
              <input matInput [id]="id('gatewayPort')" type="number" formControlName="port" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Worker</mat-label>
              <input matInput [id]="id('gatewayWorker')" type="text" [placeholder]="hrp() + '1….cpu'" formControlName="worker" />
            </mat-form-field>
            <button mat-stroked-button class="pull" type="button" [id]="id('pull-selected-gateway')" (click)="pull.emit()">Set to currently selected default</button>
            <mat-form-field appearance="outline">
              <mat-label>Password</mat-label>
              <input matInput [id]="id('gatewayPassword')" type="password" formControlName="password" />
            </mat-form-field>
          </div>
        }
      }
    </div>
  `,
})
export class DesktopMineTo {
  readonly form = input.required<FormGroup>();
  readonly chain = input.required<MinerChain>();
  readonly kindLocked = input(false);
  readonly pull = output<void>();
  protected readonly hints = HOUSE_HINTS;

  protected id(suffix: string): string {
    return `${this.chain()}-${suffix}`;
  }

  protected hrp(): string {
    return CHAINS[this.chain()].hrp;
  }

  protected kind(): string {
    return String(this.form().controls['kind'].value);
  }

  protected rpcForm(): RpcConnectForm {
    return this.form().controls['rpc'] as RpcConnectForm;
  }

  protected rpcCookie(): boolean {
    return this.rpcForm().controls.authKind.value === 'cookie';
  }

  protected rpcSummary(): string {
    const v = this.rpcForm().getRawValue();
    return `${v.host}:${v.port}`;
  }
}
