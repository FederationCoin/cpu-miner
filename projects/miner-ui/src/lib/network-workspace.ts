import { Component, inject, input } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import type { MinerChain } from './chain';
import { DocsPane } from './docs-pane';
import { FinderPane } from './finder-pane';
import { MinerPane } from './miner-pane';
import { MINER_SHELL, type WorkspaceTab } from './miner-shell';
import { PoolPane } from './pool-pane';
import { NodePane } from './node-pane';
import { WalletPane } from './wallet-pane';
import { GatewayPane } from './gateway-pane';
import { RadarPane } from './radar-pane';
import { AddonMissingCard } from './addon-missing-card';
import { WorkspaceNav } from './workspace-nav';
import { ExtrasService } from './extras.service';

@Component({
  selector: 'app-network-workspace',
  imports: [
    MinerPane,
    PoolPane,
    DocsPane,
    FinderPane,
    NodePane,
    WalletPane,
    GatewayPane,
    RadarPane,
    AddonMissingCard,
    MatTabsModule,
  ],
  templateUrl: './network-workspace.html',
  styleUrl: './network-workspace.css',
  host: { '[attr.data-chain]': 'chain()' },
})
export class NetworkWorkspace {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);
  protected readonly extras = inject(ExtrasService);
  private readonly nav = inject(WorkspaceNav);

  protected tab(): WorkspaceTab {
    return this.nav.tab();
  }

  protected showHostPool(): boolean {
    return this.shell.kind === 'desktop';
  }

  protected poolExtra(): boolean {
    return this.extras.probe().pool;
  }

  protected selectTab(id: WorkspaceTab): void {
    this.nav.selectTab(id, this.showHostPool());
  }
}
