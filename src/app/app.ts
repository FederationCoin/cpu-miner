import { Component, inject } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { CHAINS, MinerFooter, MiningService, NetworkContext, NetworkWorkspace, PoolService, type MinerChain } from '@federationcoin/miner-ui';

@Component({
  selector: 'app-root',
  imports: [NetworkWorkspace, MinerFooter, MatToolbarModule],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly mining = inject(MiningService);
  protected readonly pool = inject(PoolService);
  protected readonly network = inject(NetworkContext);

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
