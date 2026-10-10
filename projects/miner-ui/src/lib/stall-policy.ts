/** Tip older than 3 intervals (12 minutes) is a stall. Wallets wait 12 confirmations. */
export const STALL_TIP_MS = 36 * 60 * 1000;
export const STALL_CONFIRMATIONS = 12;
export const ORDINARY_CONFIRMATIONS = 1;

export function requiredConfirmations(tipAgeMs: number): number {
  return tipAgeMs > STALL_TIP_MS ? STALL_CONFIRMATIONS : ORDINARY_CONFIRMATIONS;
}
