import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWalletBlob, saveWalletBlob, walletPath } from './wallet-store.js';

describe('wallet-store', () => {
  it('round-trips a ciphertext blob and rejects empty writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-ks-'));
    expect(loadWalletBlob(dir, 'testnet')).toBeNull();
    saveWalletBlob(dir, 'testnet', '{"v":1}');
    expect(loadWalletBlob(dir, 'testnet')).toBe('{"v":1}');
    expect(walletPath(dir, 'testnet')).toContain('keystore');
    expect(() => saveWalletBlob(dir, 'testnet', '  ')).toThrow(/empty/);
  });
});
