import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { describe, expect, it, beforeEach } from 'vitest';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, webDemoShell } from './miner-shell';
import { WalletCreate12, WalletCreate24 } from './wallet-create';
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
  form: { controls: { saved: { setValue: (v: boolean) => void }; reenter: { setValue: (v: string) => void }; password: { setValue: (v: string) => void } } };
  phrase: () => string;
  save: () => Promise<void>;
  error: () => string;
};

async function render12(): Promise<ComponentFixture<WalletCreate12>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [WalletCreate12],
    providers: [
      provideAnimations(),
      { provide: HASHER_HOST, useValue: host() },
      { provide: MINER_SHELL, useValue: webDemoShell() },
    ],
  }).compileComponents();
  const f = TestBed.createComponent(WalletCreate12);
  f.componentRef.setInput('chain', 'testnet');
  f.detectChanges();
  return f;
}

describe('WalletCreate', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('creates 12 words and does not persist a re-enter mismatch', async () => {
    const f = await render12();
    const api = f.componentInstance as unknown as CreateApi;
    expect(api.phrase().split(/\s+/).length).toBe(12);
    await api.save();
    expect(api.error()).toMatch(/Save the words/);
    api.form.controls.saved.setValue(true);
    api.form.controls.reenter.setValue('not the words');
    api.form.controls.password.setValue('pw');
    await api.save();
    expect(api.error()).toMatch(/Re-enter/);
    expect(localStorage.getItem('fc.keystore.testnet')).toBeNull();
  });

  it('creates 24 words after a matching re-enter', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [WalletCreate24],
      providers: [
        provideAnimations(),
        { provide: HASHER_HOST, useValue: host() },
        { provide: MINER_SHELL, useValue: webDemoShell() },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(WalletCreate24);
    f.componentRef.setInput('chain', 'testnet');
    f.detectChanges();
    const api = f.componentInstance as unknown as CreateApi;
    expect(api.phrase().split(/\s+/).length).toBe(24);
    api.form.controls.saved.setValue(true);
    api.form.controls.reenter.setValue(api.phrase());
    api.form.controls.password.setValue('');
    await api.save();
    expect(api.error()).toMatch(/Password/);
    api.form.controls.password.setValue('pw');
    await api.save();
    expect(api.error()).toBe('');
    expect(localStorage.getItem('fc.keystore.testnet')).toBeTruthy();
  });
});
