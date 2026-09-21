import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { describe, expect, it, beforeEach } from 'vitest';
import { GatewayPane } from './gateway-pane';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, desktopShell, webDemoShell } from './miner-shell';
import { ExtrasService } from './extras.service';
import { installMemoryStorage } from './test-storage';

function host(probe: { node: boolean; gateway: boolean; pool: boolean }): HasherHost {
  return {
    canMine: true,
    inElectron: true,
    start: async () => ({ ok: true }),
    stop: async () => undefined,
    info: async () => null,
    gpus: async () => ({ devices: [], addon: false }),
    pickDatadir: async () => null,
    onStats: () => () => undefined,
    onToast: () => () => undefined,
    poolStart: async () => ({ ok: true }),
    poolStop: async () => undefined,
    onPoolStats: () => () => undefined,
    extrasProbe: async () => probe,
    gatewayStatus: async () => ({ session: 'idle', running: false, lastError: '' }),
    gatewayStart: async () => ({ ok: true }),
    gatewayStop: async () => ({ ok: true }),
  };
}

async function render(kind: 'desktop' | 'web', probe: { node: boolean; gateway: boolean; pool: boolean }): Promise<ComponentFixture<GatewayPane>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [GatewayPane],
    providers: [
      provideAnimations(),
      { provide: HASHER_HOST, useValue: host(probe) },
      { provide: MINER_SHELL, useValue: kind === 'web' ? webDemoShell() : desktopShell() },
      ExtrasService,
    ],
  }).compileComponents();
  await TestBed.inject(ExtrasService).refresh();
  const f = TestBed.createComponent(GatewayPane);
  f.componentRef.setInput('chain', 'testnet');
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return f;
}

describe('GatewayPane', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('shows a WSS card plus download CTA on the web mill', async () => {
    const f = await render('web', { node: false, gateway: false, pool: false });
    expect(f.nativeElement.querySelector('#testnet-gateway-wss')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-node-download]')).toBeTruthy();
  });

  it('shows the missing-addon card when the desktop extra is absent', async () => {
    const f = await render('desktop', { node: false, gateway: false, pool: true });
    expect(f.nativeElement.querySelector('[data-addon-missing="DATUM Gateway"]')).toBeTruthy();
  });

  it('shows House Prime as an opt-in form when the extra is present', async () => {
    const f = await render('desktop', { node: false, gateway: true, pool: true });
    expect(f.nativeElement.querySelector('#testnet-gateway-prime-host')).toBeTruthy();
    expect(f.nativeElement.textContent).toMatch(/opt-in/i);
  });
});
