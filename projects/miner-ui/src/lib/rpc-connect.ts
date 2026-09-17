import { Component, inject, input } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { MinerChain, RpcAuthKind, RpcConnect as RpcConnectValue } from './miner-api';
import { cookiePathHint } from './miner-format';
import { MiningService } from './mining.service';

export type RpcConnectForm = FormGroup<{
  host: FormControl<string>;
  port: FormControl<number>;
  authKind: FormControl<RpcAuthKind>;
  cookie: FormGroup<{ datadir: FormControl<string> }>;
  userpass: FormGroup<{ user: FormControl<string>; password: FormControl<string> }>;
}>;

export function rpcConnectGroup(port: number): RpcConnectForm {
  return new FormGroup({
    host: new FormControl('127.0.0.1', { nonNullable: true }),
    port: new FormControl(port, { nonNullable: true }),
    authKind: new FormControl<RpcAuthKind>('cookie', { nonNullable: true }),
    cookie: new FormGroup({
      datadir: new FormControl('', { nonNullable: true }),
    }),
    userpass: new FormGroup({
      user: new FormControl('', { nonNullable: true }),
      password: new FormControl('', { nonNullable: true }),
    }),
  });
}

export function rpcConnectValue(form: RpcConnectForm): RpcConnectValue {
  const v = form.getRawValue();
  if (v.authKind === 'userpass') {
    return {
      host: v.host,
      port: v.port,
      auth: { kind: 'userpass', user: v.userpass.user, password: v.userpass.password },
    };
  }
  return {
    host: v.host,
    port: v.port,
    auth: { kind: 'cookie', datadir: v.cookie.datadir },
  };
}

@Component({
  selector: 'app-rpc-connect',
  imports: [ReactiveFormsModule],
  styleUrl: './rpc-connect.css',
  templateUrl: './rpc-connect.html',
})
export class RpcConnect {
  readonly form = input.required<RpcConnectForm>();
  readonly idPrefix = input.required<string>();
  readonly chain = input.required<MinerChain>();
  readonly mining = inject(MiningService);

  protected authKind(): RpcAuthKind {
    return this.form().controls.authKind.value;
  }

  protected cookieHint(): string {
    return cookiePathHint(this.form().controls.cookie.controls.datadir.value, this.chain());
  }

  protected async browse(): Promise<void> {
    const p = await this.mining.pickDatadir();
    if (p) {
      this.form().controls.cookie.patchValue({ datadir: p });
    }
  }
}
