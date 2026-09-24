import { Injectable, signal } from '@angular/core';

export type PrimePin = {
  hostPort: string;
  identityPubkey: string;
  keysUrl: string;
};

@Injectable({ providedIn: 'root' })
export class PrimePinService {
  readonly pin = signal<PrimePin | null>(null);

  offer(pin: PrimePin): void {
    this.pin.set(pin);
  }

  clear(): void {
    this.pin.set(null);
  }
}
