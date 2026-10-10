import { Component, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-addon-missing-card',
  imports: [MatCardModule],
  template: `
    <mat-card [attr.data-addon-missing]="label()">
      <mat-card-header>
        <mat-card-title>{{ label() }}</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <p>
          This functionality is not supported with the current build because the
          requisite addon was not included.
        </p>
      </mat-card-content>
    </mat-card>
  `,
})
export class AddonMissingCard {
  readonly label = input.required<string>();
}
