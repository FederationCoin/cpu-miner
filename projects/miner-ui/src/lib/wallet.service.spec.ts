import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, webDemoShell } from './miner-shell';
import { WALLET_LOCK_MS, WalletService } from './wallet.service';
import { createPhrase } from './wallet-derive';
import { installMemoryStorage } from './test-storage';

function host(): HasherHost {
  return {
    canMine: false,
    inElectron: false,
    start: async () => ({ ok: false }),
    stop: async () => undefined,
    info: async () => null,
    gpus: async () => ({ devices: [], addon: false }),
    pickDatadir: async () => null,
    onStats: () => () => undefined,
    onToast: () => () => undefined,
    poolStart: async () => ({ ok: false }),
    poolStop: async () => undefined,
    onPoolStats: () => () => undefined,
  };
}

describe('WalletService', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  async function setup(): Promise<WalletService> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: HASHER_HOST, useValue: host() },
        { provide: MINER_SHELL, useValue: webDemoShell() },
      ],
    });
    localStorage.clear();
    return TestBed.inject(WalletService);
  }

  it('treats leftover identity as watch-only until create or import', async () => {
    const w = await setup();
    localStorage.setItem('fc.identity.wallet', 'tgfcn1leftoveraddresslong');
    await w.load('testnet');
    expect(w.view().kind).toBe('watchOnly');
    expect(w.view()).toEqual({ kind: 'watchOnly', receive: 'tgfcn1leftoveraddresslong' });
    expect(w.chipLabel()).toContain('…');
  });

  it('persists 12 words, unlocks, and rejects a wrong password', async () => {
    const w = await setup();
    const phrase = createPhrase(128);
    await w.persistPhrase(phrase, 'secret', 'testnet');
    expect(w.view().kind).toBe('unlocked');
    expect(w.receive()).toMatch(/^tgfcn1/);
    w.lock();
    expect(w.view().kind).toBe('locked');
    await expect(w.unlock('nope')).rejects.toThrow(/wrong password/);
    await w.unlock('secret');
    expect(w.signMessage('ab'.repeat(32)).length).toBeGreaterThan(40);
  });

  it('locks after five minutes idle', async () => {
    const w = await setup();
    await w.persistPhrase(createPhrase(128), 'secret', 'testnet');
    vi.useFakeTimers();
    vi.advanceTimersByTime(WALLET_LOCK_MS + 1);
    expect(() => w.signMessage('ab'.repeat(32))).toThrow(/locked/);
    vi.useRealTimers();
  });

  it('uses a different HRP on main', async () => {
    const w = await setup();
    await w.persistPhrase(createPhrase(256), 'secret', 'main');
    expect(w.receive()).toMatch(/^gfcn1/);
  });

  it('rejects an invalid phrase and unlock without a keystore', async () => {
    const w = await setup();
    await expect(w.persistPhrase('not a phrase', 'pw', 'testnet')).rejects.toThrow(/invalid phrase/);
    await expect(w.unlock('pw')).rejects.toThrow(/no keystore/);
    w.requestMineTo();
    expect(w.mineToRequest()).toBeNull();
  });

  it('sets mine-to from an unlocked receive address', async () => {
    const w = await setup();
    await w.persistPhrase(createPhrase(128), 'secret', 'testnet');
    w.requestMineTo();
    expect(w.mineToRequest()).toBe(w.receive());
    expect(w.chipLabel().length).toBeLessThan(w.receive().length);
  });

  it('keeps a short leftover address untruncated', async () => {
    const w = await setup();
    localStorage.setItem('fc.identity.wallet', 'tgfcn1short');
    await w.load('testnet');
    expect(w.chipLabel()).toBe('tgfcn1short');
  });
});
