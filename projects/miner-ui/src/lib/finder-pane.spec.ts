import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormGroup } from '@angular/forms';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FinderPane } from './finder-pane';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, webDemoShell } from './miner-shell';
import { WalletService, type WalletView } from './wallet.service';
import { IDLE_STATS } from './mining.service';
import type { MinerStartOpts, MinerStats, PoolStats } from './miner-api';
import { IDLE_POOL_STATS } from './pool.service';
import { installMemoryStorage } from './test-storage';

@Component({
  imports: [FinderPane],
  template: `<app-finder-pane chain="testnet" />`,
})
class Host {}

type PaneApi = {
  registerWithConfirm: () => void;
  confirmMillSign: () => Promise<void>;
  cancelMillSign: () => void;
  form: FormGroup;
  millSignForm: FormGroup;
  connectionArray: () => FormArray;
};

function fakeHost(): HasherHost {
  return {
    canMine: true,
    inElectron: false,
    start: async (_opts: MinerStartOpts) => ({ ok: true }),
    stop: async () => undefined,
    info: async () => ({ cookiePath: '', datadir: '', rpc: '', electron: false, defaultThreads: 4 }),
    gpus: async () => ({ devices: [], addon: false }),
    pickDatadir: async () => null,
    onStats: (cb: (s: MinerStats) => void) => {
      cb({ ...IDLE_STATS });
      return () => undefined;
    },
    onToast: () => () => undefined,
    poolStart: async () => ({ ok: false, error: 'hosted' }),
    poolStop: async () => undefined,
    onPoolStats: (cb: (s: PoolStats) => void) => {
      cb({ ...IDLE_POOL_STATS, running: true, chain: 'testnet' });
      return () => undefined;
    },
  };
}

function mockWallet(kind: WalletView['kind']): WalletService {
  const receive = 'tgfcn1qabcdefghijklmnopqrstuv';
  const view = signal<WalletView>(kind === 'empty' ? { kind: 'empty' } : { kind, receive });
  return {
    view,
    receive: signal(kind === 'empty' ? '' : receive),
    mineToRequest: signal(null),
    signMessage: vi.fn(() => 'c2lnbmF0dXJl'),
    unlock: vi.fn(async () => {
      view.set({ kind: 'unlocked', receive });
    }),
    load: vi.fn(async () => undefined),
    lock: vi.fn(),
    persistPhrase: vi.fn(),
    requestMineTo: vi.fn(),
    chipLabel: () => receive.slice(0, 8),
    isWeb: () => true,
  } as unknown as WalletService;
}

describe('FinderPane mill sign', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  async function render(kind: WalletView['kind']): Promise<ComponentFixture<Host>> {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ items: [], groups: [] }), { status: 200 }));
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideAnimations(),
        { provide: MINER_SHELL, useValue: webDemoShell() },
        { provide: HASHER_HOST, useValue: fakeHost() },
        { provide: WalletService, useValue: mockWallet(kind) },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  }

  it('registerWithConfirm requires a keystore', async () => {
    const f = await render('empty');
    const pane = f.debugElement.children[0].componentInstance as unknown as PaneApi;
    pane.registerWithConfirm();
    f.detectChanges();
    expect(f.nativeElement.textContent).toMatch(/keystore/);
    vi.unstubAllGlobals();
  });

  it('registerWithConfirm then confirmMillSign fills the signature', async () => {
    const f = await render('unlocked');
    const pane = f.debugElement.children[0].componentInstance as unknown as PaneApi;
    pane.form.controls['name']?.setValue('Pool');
    const row = pane.connectionArray().at(0) as FormGroup;
    row.controls['url'].setValue('stratum.example.com:23334');
    pane.form.controls['signingBlockHeight'].setValue('10');
    pane.form.controls['signingBlockHash'].setValue('ab'.repeat(32));
    pane.registerWithConfirm();
    f.detectChanges();
    expect(f.nativeElement.querySelector('#testnet-finder-mill-sign')).toBeTruthy();
    await pane.confirmMillSign();
    f.detectChanges();
    expect(pane.form.controls['signature'].value).toBe('c2lnbmF0dXJl');
    pane.cancelMillSign();
    vi.unstubAllGlobals();
  });

  it('confirmMillSign unlocks a locked keystore', async () => {
    const f = await render('locked');
    const pane = f.debugElement.children[0].componentInstance as unknown as PaneApi;
    const row = pane.connectionArray().at(0) as FormGroup;
    row.controls['url'].setValue('stratum.example.com:23334');
    pane.form.controls['signingBlockHeight'].setValue('10');
    pane.form.controls['signingBlockHash'].setValue('ab'.repeat(32));
    pane.registerWithConfirm();
    pane.millSignForm.controls['password'].setValue('pw');
    await pane.confirmMillSign();
    const wallet = TestBed.inject(WalletService);
    expect(wallet.unlock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
