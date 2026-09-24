import type { WalletView } from './wallet.service';

export type MillSignKind = 'register' | 'attest';

export function millSignNeedsKeystore(view: WalletView): boolean {
  return view.kind === 'empty' || view.kind === 'watchOnly';
}

export function millSignNeedsPassword(view: WalletView): boolean {
  return view.kind === 'locked';
}
