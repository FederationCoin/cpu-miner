import { Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';

export type ListenReach = 'computer' | 'network';

export function listenBindAddr(reach: ListenReach): '127.0.0.1' | '0.0.0.0' {
  return reach === 'network' ? '0.0.0.0' : '127.0.0.1';
}

export function listenLabel(reach: ListenReach): string {
  return reach === 'network' ? 'This network' : 'This computer';
}

@Component({
  selector: 'app-listen-reach',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './listen-reach.html',
  styleUrl: './listen-reach.css',
})
export class ListenReachField {
  readonly fieldId = input.required<string>();
  readonly control = input.required<FormControl<ListenReach>>();
}
