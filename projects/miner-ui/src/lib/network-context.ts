import { Injectable, signal } from '@angular/core';
import type { MinerChain } from './chain';

const KEY = 'fc.network';

@Injectable({ providedIn: 'root' })
export class NetworkContext {
  readonly chain = signal<MinerChain>(loadNetwork());

  setChain(id: MinerChain): void {
    this.chain.set(id);
    localStorage.setItem(KEY, id);
  }
}

function loadNetwork(): MinerChain {
  return localStorage.getItem(KEY) === 'main' ? 'main' : 'testnet';
}
