import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { describe, expect, it, beforeEach } from 'vitest';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, webDemoShell } from './miner-shell';
import { WalletCreate, WalletCreate12, WalletCreate24 } from './wallet-create';
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

type CreateApi = {
  generate: () => void;
  saved: () => void;
  save: () => Promise<void>;
  error: () => string;
  shownWords: () => { value: string; setValue: (v: string) => void }[];
  confirmWords: () => { setValue: (v: string) => void }[];
  password: { setValue: (v: string) => void };
};

async function render(word: 12 | 24): Promise<CreateApi> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [word === 12 ? WalletCreate12 : WalletCreate24],
    providers: [
      provideAnimations(),
      { provide: HASHER_HOST, useValue: host() },
      { provide: MINER_SHELL, useValue: webDemoShell() },
    ],
  }).compileComponents();
  const f: ComponentFixture<WalletCreate12 | WalletCreate24> =
    word === 12 ? TestBed.createComponent(WalletCreate12) : TestBed.createComponent(WalletCreate24);
  f.componentRef.setInput('chain', 'testnet');
  f.detectChanges();
  return f.debugElement.query(By.directive(WalletCreate)).componentInstance as unknown as CreateApi;
}

describe('WalletCreate', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('does not persist until the re-entered words match', async () => {
    const api = await render(12);
    api.saved();
    expect(api.error()).toMatch(/Generate/);
    api.generate();
    expect(api.shownWords().filter((c) => c.value).length).toBe(12);
    api.saved();
    api.confirmWords().forEach((c) => c.setValue('abandon'));
    api.password.setValue('pw');
    await api.save();
    expect(api.error()).toMatch(/Re-enter/);
    expect(localStorage.getItem('fc.keystore.testnet')).toBeNull();
  });

  it('saves 24 words after a matching re-enter', async () => {
    const api = await render(24);
    api.generate();
    const words = api.shownWords().map((c) => c.value);
    expect(words.length).toBe(24);
    api.saved();
    api.confirmWords().forEach((c, i) => c.setValue(words[i] ?? ''));
    api.password.setValue('');
    await api.save();
    expect(api.error()).toMatch(/Password/);
    api.password.setValue('pw');
    await api.save();
    expect(api.error()).toBe('');
    expect(localStorage.getItem('fc.keystore.testnet')).toBeTruthy();
  });
});
