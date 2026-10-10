import { afterNextRender, Component, ElementRef, inject, input } from '@angular/core';

@Component({
  selector: 'app-defaults-fold',
  styleUrl: './defaults-fold.css',
  templateUrl: './defaults-fold.html',
})
export class DefaultsFold {
  readonly title = input.required<string>();
  readonly summary = input.required<string>();
  readonly open = input(false);
  readonly foldId = input('');

  constructor() {
    const host = inject(ElementRef<HTMLElement>);
    afterNextRender(() => {
      if (!this.open()) {
        return;
      }
      const details = host.nativeElement.querySelector('details');
      if (details) {
        details.open = true;
      }
    });
  }
}
