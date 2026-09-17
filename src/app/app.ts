import { Component, effect, inject } from '@angular/core';
import { CHAINS, type MinerChain } from './chain';
import { MiningService } from './mining.service';
import { NetworkContext } from './network-context';
import { NetworkWorkspace } from './network-workspace';
import { PoolService } from './pool.service';

@Component({
  selector: 'app-root',
  imports: [NetworkWorkspace],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly mining = inject(MiningService);
  protected readonly pool = inject(PoolService);
  protected readonly network = inject(NetworkContext);

  constructor() {
    effect(() => {
      const s = this.pool.stats();
      const kind = this.mining.sessionKind();
      if (!s.running && (kind === 'appPoolStratum' || kind === 'appPoolDatum')) {
        void this.mining.stop();
        this.mining.warn('App pool stopped; mining stopped.');
      }
    });
  }

  protected selectNetwork(id: MinerChain): void {
    const current = this.network.chain();
    if (id === current) {
      return;
    }
    const miningChain = this.mining.activeChain();
    if (miningChain && miningChain !== id) {
      void this.mining.stop();
      this.mining.warn(`Stopped mining; switched to ${CHAINS[id].label}.`);
    }
    const pool = this.pool.stats();
    if (pool.running && pool.chain && pool.chain !== id) {
      void this.pool.stop();
      this.mining.warn(`Stopped pool; switched to ${CHAINS[id].label}.`);
    }
    this.network.setChain(id);
  }
}
