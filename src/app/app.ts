import { Component, inject, signal } from '@angular/core';
import { MinerPane } from './miner-pane';
import { MiningService } from './mining.service';
import type { MinerChain } from './chain';

@Component({
  selector: 'app-root',
  imports: [MinerPane],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly mining = inject(MiningService);
  protected readonly tab = signal<MinerChain>('main');

  protected selectTab(id: MinerChain): void {
    this.tab.set(id);
  }
}
