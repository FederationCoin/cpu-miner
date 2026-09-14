import { Component, inject, signal } from '@angular/core';
import { MinerPane } from './miner-pane';
import { MiningService } from './mining.service';
import { PoolPane } from './pool-pane';
import type { MinerChain } from './chain';

export type AppTab = MinerChain | 'pool';

@Component({
  selector: 'app-root',
  imports: [MinerPane, PoolPane],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly mining = inject(MiningService);
  protected readonly tab = signal<AppTab>('main');

  protected selectTab(id: AppTab): void {
    this.tab.set(id);
  }
}
