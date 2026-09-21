import { describe, expect, it } from 'vitest';
import { millSignNeedsKeystore, millSignNeedsPassword } from './finder-sign';

describe('finder-sign', () => {
  it('splits keystore-required vs password-required views', () => {
    expect(millSignNeedsKeystore({ kind: 'empty' })).toBe(true);
    expect(millSignNeedsKeystore({ kind: 'watchOnly', receive: 'tgfcn1a' })).toBe(true);
    expect(millSignNeedsKeystore({ kind: 'locked', receive: 'tgfcn1a' })).toBe(false);
    expect(millSignNeedsKeystore({ kind: 'unlocked', receive: 'tgfcn1a' })).toBe(false);
    expect(millSignNeedsPassword({ kind: 'locked', receive: 'tgfcn1a' })).toBe(true);
    expect(millSignNeedsPassword({ kind: 'unlocked', receive: 'tgfcn1a' })).toBe(false);
    expect(millSignNeedsPassword({ kind: 'empty' })).toBe(false);
  });
});
