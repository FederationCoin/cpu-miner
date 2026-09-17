import { Component, ElementRef, afterRenderEffect, input, viewChild } from '@angular/core';
import type { MinerChain } from './chain';

@Component({
  selector: 'app-webgpu-help',
  styleUrl: './webgpu-help.css',
  templateUrl: './webgpu-help.html',
})
export class WebgpuHelp {
  readonly chain = input.required<MinerChain>();
  readonly autoOpen = input(false);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private didAutoOpen = false;

  constructor() {
    afterRenderEffect(() => {
      if (!this.autoOpen() || this.didAutoOpen) {
        return;
      }
      this.didAutoOpen = true;
      this.open();
    });
  }

  protected id(suffix: string): string {
    return `${this.chain()}-${suffix}`;
  }

  protected open(): void {
    const el = this.dlg()?.nativeElement;
    if (el) {
      this.show(el);
    }
  }

  protected close(): void {
    const el = this.dlg()?.nativeElement;
    if (!el) {
      return;
    }
    if (typeof el.close === 'function') {
      try {
        el.close();
        return;
      } catch {
        /* jsdom */
      }
    }
    el.removeAttribute('open');
  }

  private show(el: HTMLDialogElement): void {
    if (typeof el.showModal === 'function') {
      try {
        if (!el.open) {
          el.showModal();
        }
        return;
      } catch {
        /* jsdom */
      }
    }
    el.setAttribute('open', '');
  }
}
