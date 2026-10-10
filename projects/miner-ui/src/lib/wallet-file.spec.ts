import { describe, expect, it } from 'vitest';
import { newWalletId, parseWalletStore, storeWasList } from './wallet-file';

const blob = {
  v: 1,
  kdf: 'argon2id',
  salt: 'aa',
  nonce: 'bb',
  ciphertext: 'cc',
  receive: 'tgfcn1qqqqqqqqqqqq',
};

describe('wallet-file', () => {
  it('returns null for empty or broken JSON', () => {
    expect(parseWalletStore('')).toBeNull();
    expect(parseWalletStore('  ')).toBeNull();
    expect(parseWalletStore('{')).toBeNull();
    expect(parseWalletStore('{"v":1}')).toBeNull();
    expect(storeWasList('{')).toBe(false);
  });

  it('migrates a single keystore blob into a one-wallet list', () => {
    const raw = JSON.stringify(blob);
    const store = parseWalletStore(raw);
    expect(store?.wallets).toHaveLength(1);
    expect(store?.selectedId).toBe(store?.wallets[0].id);
    expect(store?.mineToId).toBe('');
    expect(storeWasList(raw)).toBe(false);
  });

  it('mints an id and rejects store shapes that are not a wallet list', () => {
    expect(newWalletId().length).toBeGreaterThan(8);
    const prev = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    expect(newWalletId()).toMatch(/^w-/);
    Object.defineProperty(globalThis, 'crypto', { value: prev, configurable: true });
    expect(parseWalletStore('null')).toBeNull();
    expect(parseWalletStore('[]')).toBeNull();
    expect(parseWalletStore(JSON.stringify({ wallets: [null], selectedId: 'a', mineToId: '' }))).toBeNull();
    expect(parseWalletStore(JSON.stringify({ wallets: [{ id: 1, blob }], selectedId: 'a', mineToId: '' }))).toBeNull();
  });

  it('reads a list and rejects a wallet row without a blob', () => {
    const raw = JSON.stringify({
      wallets: [{ id: 'a', blob }],
      selectedId: 'a',
      mineToId: '',
    });
    expect(parseWalletStore(raw)?.selectedId).toBe('a');
    expect(storeWasList(raw)).toBe(true);
    expect(parseWalletStore(JSON.stringify({ wallets: [{ id: 'a' }], selectedId: 'a', mineToId: '' }))).toBeNull();
    expect(parseWalletStore(JSON.stringify({ wallets: 'no', selectedId: 'a', mineToId: '' }))).toBeNull();
  });
});
