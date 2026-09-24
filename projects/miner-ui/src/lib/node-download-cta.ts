import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';

const RELEASES = 'https://github.com/FederationCoin/cpu-miner/releases';
const REPO = 'https://github.com/FederationCoin/cpu-miner';

@Component({
  selector: 'app-node-download-cta',
  imports: [MatCardModule, MatButtonModule],
  template: `
    <mat-card data-node-download>
      <mat-card-header>
        <mat-card-title>Desktop node</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <p>
          This web mill cannot start <code>federationcoind</code>. Download The Big One
          (unsigned draft) or clone the mill repo and run Electron.
        </p>
        <div class="row">
          <a mat-flat-button color="primary" [href]="releases" target="_blank" rel="noopener">Draft Releases</a>
          <a mat-stroked-button [href]="repo" target="_blank" rel="noopener">cpu-miner on GitHub</a>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [
    `
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 0.75rem;
      }
    `,
  ],
})
export class NodeDownloadCta {
  protected readonly releases = RELEASES;
  protected readonly repo = REPO;
}
