import { Component, inject, input } from '@angular/core';
import type { MinerChain } from './chain';
import { MINER_SHELL } from './miner-shell';

@Component({
  selector: 'app-docs-pane',
  styleUrl: './miner-pane.css',
  templateUrl: './docs-pane.html',
})
export class DocsPane {
  readonly chain = input.required<MinerChain>();
  protected readonly shell = inject(MINER_SHELL);

  protected id(suffix: string): string {
    return `${this.chain()}-docs-${suffix}`;
  }

  protected isWeb(): boolean {
    return this.shell.kind === 'webDemo';
  }
}
