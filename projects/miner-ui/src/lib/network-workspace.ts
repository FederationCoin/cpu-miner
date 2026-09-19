import { Component, inject, input, signal } from '@angular/core';
import type { MinerChain } from './chain';
import { DocsPane } from './docs-pane';
import { FinderPane } from './finder-pane';
import { MinerPane } from './miner-pane';
import { MINER_SHELL, type WorkspaceTab } from './miner-shell';
import { PoolPane } from './pool-pane';

@Component({
  selector: 'app-network-workspace',
  imports: [MinerPane, PoolPane, DocsPane, FinderPane],
  templateUrl: './network-workspace.html',
  styleUrl: './network-workspace.css',
  host: { '[attr.data-chain]': 'chain()' },
})
export class NetworkWorkspace {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  protected readonly tab = signal<WorkspaceTab>('mine');

  protected showHostPool(): boolean {
    return this.shell.kind === 'desktop';
  }

  protected selectTab(id: WorkspaceTab): void {
    if (id === 'pool' && !this.showHostPool()) {
      return;
    }
    this.tab.set(id);
  }
}
