import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import type { PortLine } from './miner-api';

@Component({
  selector: 'app-process-card',
  imports: [MatButtonModule, MatCardModule],
  templateUrl: './process-card.html',
  styleUrl: './process-card.css',
})
export class ProcessCard {
  readonly idPrefix = input.required<string>();
  readonly title = input.required<string>();
  readonly pathLabel = input.required<string>();
  readonly otherNoun = input.required<string>();
  readonly showStart = input(false);
  readonly showStop = input(false);
  readonly showBrowse = input(false);
  readonly path = input('');
  readonly pathDisabled = input(false);
  readonly command = input('');
  readonly pid = input<number | null>(null);
  readonly cpu = input('');
  readonly rss = input('');
  readonly otherCount = input(0);
  readonly ports = input<PortLine[]>([]);
  readonly logTail = input('');
  readonly lastError = input('');
  readonly session = input('idle');
  readonly height = input<number | null>(null);
  readonly poll = output<void>();
  readonly start = output<void>();
  readonly stop = output<void>();
  readonly browse = output<void>();
  readonly pathChange = output<string>();

  protected dash(value: string | number | null | undefined): string {
    if (value == null || value === '') {
      return '—';
    }
    return String(value);
  }

  protected onPath(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.pathChange.emit(target.value);
    }
  }
}
