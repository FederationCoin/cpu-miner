import { Component, input } from '@angular/core';
import type { MinerChain } from './chain';
import { MinerPane } from './miner-pane';
import { PoolPane } from './pool-pane';

@Component({
  selector: 'app-network-workspace',
  imports: [MinerPane, PoolPane],
  templateUrl: './network-workspace.html',
  styleUrl: './network-workspace.css',
  host: { '[attr.data-chain]': 'chain()' },
})
export class NetworkWorkspace {
  readonly chain = input.required<MinerChain>();
}
