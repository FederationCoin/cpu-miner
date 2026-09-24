import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, webDemoShell } from './miner-shell';
import { NetworkContext } from './network-context';
import { installMemoryStorage } from './test-storage';
import { WalletPane } from './wallet-pane';
import { WalletService } from './wallet.service';
import { createPhrase } from './wallet-derive';

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

describe('WalletPane', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('does not let the hidden network pane clear the selected wallet', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [WalletPane],
      providers: [
        provideAnimations(),
        { provide: HASHER_HOST, useValue: host() },
        { provide: MINER_SHELL, useValue: webDemoShell() },
        NetworkContext,
      ],
    }).compileComponents();
    const wallet = TestBed.inject(WalletService);
    await wallet.persistPhrase(createPhrase(128), 'secret', 'testnet');
    const receive = wallet.receive();
    const f: ComponentFixture<WalletPane> = TestBed.createComponent(WalletPane);
    f.componentRef.setInput('chain', 'main');
    f.detectChanges();
    await f.whenStable();
    expect(wallet.receive()).toBe(receive);
    expect(wallet.chipLabel()).toContain('…');
    expect(f.nativeElement.querySelector('svg')).toBeTruthy();
    expect(f.nativeElement.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 640 480');
  });
});
