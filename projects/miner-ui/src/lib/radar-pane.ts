import { Component, OnInit, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { radarAllowsIframe } from './radar-frame';

export const RADAR_URL = 'https://radar.federationcoin.org';

@Component({
  selector: 'app-radar-pane',
  imports: [MatCardModule, MatButtonModule],
  template: `
    <div class="pane">
      @if (framed()) {
        <iframe title="Radar" [src]="safeUrl" class="radar-frame" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>
      } @else {
        <mat-card>
          <mat-card-header>
            <mat-card-title>Radar</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p>This build could not show Radar in a frame.</p>
            <a mat-flat-button color="primary" [href]="url" target="_blank" rel="noopener">Open Radar</a>
          </mat-card-content>
        </mat-card>
      }
      <p class="hint">Radar has no wallet bridge. Keys and phrases stay in this mill.</p>
      <a mat-stroked-button [href]="url" target="_blank" rel="noopener">Open Radar in a new window</a>
    </div>
  `,
  styles: [
    `
      .radar-frame {
        width: 100%;
        min-height: 36rem;
        border: 1px solid #c9a85a;
        background: #0e1824;
      }
      .hint {
        margin-top: 0.75rem;
      }
    `,
  ],
})
export class RadarPane implements OnInit {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly url = RADAR_URL;
  protected readonly framed = signal(true);
  protected readonly safeUrl: SafeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(RADAR_URL);

  ngOnInit(): void {
    void this.probeFrame();
  }

  private async probeFrame(): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);
    try {
      const res = await fetch(RADAR_URL, { method: 'HEAD', mode: 'cors', signal: ctrl.signal });
      if (!radarAllowsIframe(res.headers.get('x-frame-options'), res.headers.get('content-security-policy'))) {
        this.framed.set(false);
      }
    } catch {
      /* CORS or network: keep the iframe; the new-window link is always available. */
    } finally {
      clearTimeout(timer);
    }
  }
}
