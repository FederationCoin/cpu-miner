import { Component, effect, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatToolbarModule } from '@angular/material/toolbar';
import { CHAINS, ListenerChips, MinerFooter, MiningService, NetworkContext, NetworkWorkspace, PoolService, WalletService, type MinerChain } from '@federationcoin/miner-ui';

@Component({
  selector: 'app-root',
  imports: [NetworkWorkspace, MinerFooter, ListenerChips, MatToolbarModule, MatFormFieldModule, MatSelectModule, MatButtonModule, MatIconModule],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly mining = inject(MiningService);
  protected readonly pool = inject(PoolService);
  protected readonly network = inject(NetworkContext);
  protected readonly wallet = inject(WalletService);

  constructor() {
    effect(() => {
      void this.wallet.load(this.network.chain());
    });
  }

  protected copyWallet(): void {
    const address = this.wallet.receive();
    if (address) {
      void navigator.clipboard?.writeText(address);
    }
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
