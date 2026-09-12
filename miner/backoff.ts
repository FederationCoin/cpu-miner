export const BACKOFF_FIRST_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

/** Next reconnect delay. First failure uses firstMs; then double, cap at maxMs. */
export function nextBackoff(
  lastMs: number | 0,
  firstMs = BACKOFF_FIRST_MS,
  maxMs = BACKOFF_MAX_MS,
): number {
  if (lastMs <= 0) {
    return firstMs;
  }
  return Math.min(maxMs, lastMs * 2);
}
