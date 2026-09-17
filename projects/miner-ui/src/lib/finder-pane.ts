import { Component, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { MinerChain } from './chain';
import { CURATED_POOLS, EMPTY_POOL_SLOTS, type PoolListing } from './finder-data';
import { MINER_SHELL } from './miner-shell';
import { PoolService } from './pool.service';

@Component({
  selector: 'app-finder-pane',
  imports: [ReactiveFormsModule],
  styleUrl: './miner-pane.css',
  templateUrl: './finder-pane.html',
})
export class FinderPane {
  readonly chain = input.required<MinerChain>();
  protected readonly pool = inject(PoolService);
  protected readonly shell = inject(MINER_SHELL);
  protected readonly notice = signal('');
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    tag: new FormControl('', { nonNullable: true }),
    stratum: new FormControl('', { nonNullable: true }),
    datum: new FormControl('', { nonNullable: true }),
  });

  protected id(suffix: string): string {
    return `${this.chain()}-finder-${suffix}`;
  }

  protected listings(): PoolListing[] {
    if (this.chain() === 'main') {
      return EMPTY_POOL_SLOTS;
    }
    return CURATED_POOLS;
  }

  protected listingHint(p: PoolListing): string {
    if (!p.house || this.shell.kind !== 'webDemo') {
      return p.hashrateHint;
    }
    const s = this.pool.stats();
    return `${s.workers} workers · ${s.accepted} shares accepted · height ${s.height}. House demo, not the pool of record.`;
  }

  protected submit(): void {
    this.notice.set(
      'Register is a stub. A verifiable directory is later: coinbase ASCII tag plus a Stratum we can connect to, and observed work. A form post is not proof.',
    );
  }
}
