import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CHAINS, type MinerChain } from './chain';
import { isLoopbackWsHost, peerStatusLabel, type PeerStatus } from './stratum-ws';
import type { GatewayInfoView } from './gateway-info';
import { HOUSE_HINTS } from './house-hints';

const LOOPBACK_GATEWAY_TOOLTIP =
  'localhost gateway needs Apps On Device; if you rejected the prompt and still want to mine to a localhost DATUM Gateway, re-enable it in site settings';

@Component({
  selector: 'app-web-mine-to',
  imports: [
    ReactiveFormsModule,
    MatRadioModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatTooltipModule,
  ],
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
      }
    `,
  ],
  template: `
    <div [formGroup]="form()">
      <mat-radio-group formControlName="kind" [attr.aria-label]="'Mine to'">
        <mat-radio-button [id]="id('mineToStratumPoolWebsocket')" value="stratumPoolWebsocket" [disabled]="kindLocked()">
          Stratum pool via WebSocket
        </mat-radio-button>
        <mat-radio-button [id]="id('mineToDatumGatewayWebsocket')" value="datumGatewayWebsocket" [disabled]="kindLocked()">
          DATUM Gateway via WebSocket
        </mat-radio-button>
      </mat-radio-group>
      @if (kind() === 'stratumPoolWebsocket') {
        <p class="hint">
          Mine over Stratum v1 on WebSocket (newline JSON-RPC, password <code>x</code>).
          Pool Finder → Mine this fills this URL.
        </p>
        <div class="mine-fields" formGroupName="poolWebsocket">
          <mat-form-field appearance="outline">
            <mat-label>Stratum pool WebSocket URL</mat-label>
            <input matInput [id]="id('stratumPoolWebsocketUrl')" type="text" [placeholder]="hints.stratumWss" formControlName="url" />
            <mat-hint>{{ hints.stratumWss }}</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Worker</mat-label>
            <input matInput [id]="id('stratumPoolWebsocketWorker')" type="text" [placeholder]="hrp() + '1….cpu'" formControlName="worker" />
          </mat-form-field>
          <button mat-stroked-button type="button" [id]="id('pull-selected-pool')" (click)="pull.emit()">Set to currently selected default</button>
        </div>
      }
      @if (kind() === 'datumGatewayWebsocket') {
        <p class="hint">
          This is your local gateway’s Stratum listener, not the DATUM Prime Pool and not the pool.
        </p>
        <div class="mine-fields" formGroupName="gatewayWebsocket">
          <mat-form-field appearance="outline">
            <mat-label>DATUM Gateway WebSocket URL</mat-label>
            <input matInput [id]="id('datumGatewayWebsocketUrl')" type="text" [placeholder]="hints.gatewayWss" formControlName="url" />
            <mat-hint>{{ hints.gatewayWss }}</mat-hint>
            @if (loopbackWarning()) {
              <mat-icon matSuffix class="url-warn" [id]="id('gatewayLoopbackWarning')" [matTooltip]="loopbackTooltip">warning</mat-icon>
            }
          </mat-form-field>
          <mat-card class="pool-info-card" [attr.id]="id('gateway-info')">
            <mat-card-header>
              <mat-card-title>Gateway info</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              @if (gatewayInfo(); as info) {
                @switch (info.kind) {
                  @case ('notRequested') {
                    <p class="hint">Not yet requested</p>
                    <button mat-stroked-button type="button" [id]="id('gateway-info-fetch')" (click)="fetchInfo.emit()">Fetch gateway info</button>
                  }
                  @case ('notProvided') {
                    <p>Gateway is not providing gateway info</p>
                    <p class="hint">as of {{ formatAsOf(info.asOf) }}</p>
                    <button mat-stroked-button type="button" [id]="id('gateway-info-refresh')" (click)="fetchInfo.emit()">Refresh</button>
                  }
                  @case ('provided') {
                    <p>Gateway published info</p>
                    <dl>
                      <dt>Node</dt>
                      <dd>{{ statusLabel(info.nodeStatus) }}</dd>
                      @if (info.prime) {
                        <dt>DATUM Prime Pool</dt>
                        <dd class="mono">{{ info.prime }}</dd>
                      }
                      @if (info.poolStatus) {
                        <dt>Pool</dt>
                        <dd>{{ statusLabel(info.poolStatus) }}</dd>
                      }
                      @if (info.name) {
                        <dt>Name</dt>
                        <dd>{{ info.name }}</dd>
                      }
                      @if (info.coinbaseTag) {
                        <dt>Coinbase tag</dt>
                        <dd class="mono">{{ info.coinbaseTag }}</dd>
                      }
                      @if (info.websiteUrl) {
                        <dt>Website</dt>
                        <dd class="mono">{{ info.websiteUrl }}</dd>
                      }
                    </dl>
                    <p class="hint">as of {{ formatAsOf(info.asOf) }}</p>
                    <button mat-stroked-button type="button" [id]="id('gateway-info-refresh')" (click)="fetchInfo.emit()">Refresh</button>
                  }
                }
              }
            </mat-card-content>
          </mat-card>
          <mat-form-field appearance="outline">
            <mat-label>Worker</mat-label>
            <input matInput [id]="id('datumGatewayWebsocketWorker')" type="text" [placeholder]="hrp() + '1….cpu'" formControlName="worker" />
          </mat-form-field>
          <button mat-stroked-button type="button" [id]="id('pull-selected-gateway-ws')" (click)="pull.emit()">Set to currently selected default</button>
        </div>
      }
    </div>
  `,
})
export class WebMineTo {
  readonly form = input.required<FormGroup>();
  readonly chain = input.required<MinerChain>();
  readonly kindLocked = input(false);
  readonly gatewayInfo = input.required<GatewayInfoView>();
  readonly fetchInfo = output<void>();
  readonly pull = output<void>();
  protected readonly loopbackTooltip = LOOPBACK_GATEWAY_TOOLTIP;
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

  protected loopbackWarning(): boolean {
    const url = String(this.form().getRawValue().gatewayWebsocket?.url ?? '');
    return this.kind() === 'datumGatewayWebsocket' && isLoopbackWsHost(url);
  }

  protected formatAsOf(asOf: number): string {
    return new Date(asOf).toLocaleString();
  }

  protected statusLabel(status: PeerStatus): string {
    return peerStatusLabel(status);
  }
}
