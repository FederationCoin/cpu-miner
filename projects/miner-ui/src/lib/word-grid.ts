import { Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-word-grid',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule],
  styles: [
    `
      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      mat-form-field {
        width: 100%;
      }
    `,
  ],
  template: `
    <div class="grid">
      @for (ctrl of words(); track $index) {
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>{{ $index + 1 }}</mat-label>
          <input
            matInput
            autocomplete="off"
            spellcheck="false"
            [formControl]="ctrl"
            [readonly]="readonly()"
            (paste)="block($event)"
            (drop)="block($event)"
          />
        </mat-form-field>
      }
    </div>
  `,
})
export class WordGrid {
  readonly words = input.required<FormControl<string>[]>();
  readonly readonly = input(false);

  protected block(event: Event): void {
    event.preventDefault();
  }
}
