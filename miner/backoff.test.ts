import { describe, expect, it } from 'vitest';
import { BACKOFF_FIRST_MS, BACKOFF_MAX_MS, nextBackoff } from './backoff.js';

describe('nextBackoff', () => {
  it('starts at 1s then doubles to 60s', () => {
    let d = 0;
    d = nextBackoff(d);
    expect(d).toBe(BACKOFF_FIRST_MS);
    d = nextBackoff(d);
    expect(d).toBe(2000);
    d = nextBackoff(d);
    expect(d).toBe(4000);
    d = nextBackoff(32000);
    expect(d).toBe(BACKOFF_MAX_MS);
    expect(nextBackoff(BACKOFF_MAX_MS)).toBe(BACKOFF_MAX_MS);
  });
});
