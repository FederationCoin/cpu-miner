import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { describe, expect, it, beforeEach } from 'vitest';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, webDemoShell } from './miner-shell';
import { WalletImport } from './wallet-import';
import { installMemoryStorage } from './test-storage';

const TWELVE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

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

type ImportApi = {
  boxes: { setValue: (v: string) => void }[];
  password: { setValue: (v: string) => void };
  save: () => Promise<void>;
  error: () => string;
};

describe('WalletImport', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('rejects an invalid phrase and empty password, then imports', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [WalletImport],
      providers: [
        provideAnimations(),
        { provide: HASHER_HOST, useValue: host() },
        { provide: MINER_SHELL, useValue: webDemoShell() },
      ],
    }).compileComponents();
    const f: ComponentFixture<WalletImport> = TestBed.createComponent(WalletImport);
    f.componentRef.setInput('chain', 'testnet');
    f.detectChanges();
    const api = f.componentInstance as unknown as ImportApi;
    await api.save();
    expect(api.error()).toMatch(/invalid phrase/);
    TWELVE.split(' ').forEach((word, i) => api.boxes[i]?.setValue(word));
    api.password.setValue('');
    await api.save();
    expect(api.error()).toMatch(/Password/);
    api.password.setValue('pw');
    await api.save();
    expect(api.error()).toBe('');
    expect(localStorage.getItem('fc.keystore.testnet')).toBeTruthy();
  });
});
