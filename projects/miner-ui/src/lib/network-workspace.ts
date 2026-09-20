import { Component, inject, input } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import type { MinerChain } from './chain';
import { DocsPane } from './docs-pane';
import { FinderPane } from './finder-pane';
import { MinerPane } from './miner-pane';
import { MINER_SHELL, type WorkspaceTab } from './miner-shell';
import { PoolPane } from './pool-pane';
import { WorkspaceNav } from './workspace-nav';

@Component({
  selector: 'app-network-workspace',
  imports: [MinerPane, PoolPane, DocsPane, FinderPane, MatTabsModule],
  templateUrl: './network-workspace.html',
  styleUrl: './network-workspace.css',
  host: { '[attr.data-chain]': 'chain()' },
})
export class NetworkWorkspace {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  private readonly nav = inject(WorkspaceNav);

  protected tab(): WorkspaceTab {
    return this.nav.tab();
  }

  protected showHostPool(): boolean {
    return this.shell.kind === 'desktop';
  }

  protected selectTab(id: WorkspaceTab): void {
    this.nav.selectTab(id, this.showHostPool());
  }
}
