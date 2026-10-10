import { Injectable, signal } from '@angular/core';
import type { WorkspaceTab } from './miner-shell';

@Injectable({ providedIn: 'root' })
export class WorkspaceNav {
  readonly tab = signal<WorkspaceTab>('mine');

  selectTab(id: WorkspaceTab, allowPool: boolean): void {
    if (id === 'pool' && !allowPool) {
      return;
    }
    this.tab.set(id);
  }

  goMine(): void {
    this.tab.set('mine');
  }
}
