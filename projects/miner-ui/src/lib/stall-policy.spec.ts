import { describe, expect, it } from 'vitest';
import { ORDINARY_CONFIRMATIONS, STALL_CONFIRMATIONS, STALL_TIP_MS, requiredConfirmations } from './stall-policy';

describe('stall-policy', () => {
  it('waits 12 confirmations only while the tip is older than 36 minutes', () => {
    expect(requiredConfirmations(STALL_TIP_MS)).toBe(ORDINARY_CONFIRMATIONS);
    expect(requiredConfirmations(STALL_TIP_MS + 1)).toBe(STALL_CONFIRMATIONS);
  });
});
