import { Component, inject } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatToolbarModule } from '@angular/material/toolbar';
import { CHAINS, MinerFooter, MiningService, NetworkContext, NetworkWorkspace, type MinerChain } from '@federationcoin/miner-ui';

@Component({
  selector: 'app-root',
  imports: [NetworkWorkspace, MinerFooter, MatToolbarModule, MatFormFieldModule, MatSelectModule],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly mining = inject(MiningService);
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
    this.network.setChain(id);
  }
}
