import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { describe, expect, it, beforeEach } from 'vitest';
import { GatewayPane } from './gateway-pane';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, desktopShell, webDemoShell } from './miner-shell';
import { ExtrasService } from './extras.service';
import { EMPTY_GATEWAY_STATUS } from './miner-api';
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
    gatewayStatus: async () => EMPTY_GATEWAY_STATUS,
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

  it('shows Starting and hides Stop until the gateway start finishes', async () => {
    let release: (value: { ok: boolean }) => void = () => undefined;
    let calls = 0;
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [GatewayPane],
      providers: [
        provideAnimations(),
        {
          provide: HASHER_HOST,
          useValue: {
            ...host({ node: false, gateway: true, pool: true }),
            gatewayStart: () => {
              calls += 1;
              return new Promise((resolve) => {
                release = resolve;
              });
            },
          },
        },
        { provide: MINER_SHELL, useValue: desktopShell() },
        ExtrasService,
      ],
    }).compileComponents();
    await TestBed.inject(ExtrasService).refresh();
    const f = TestBed.createComponent(GatewayPane);
    f.componentRef.setInput('chain', 'testnet');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    f.detectChanges();
    (f.nativeElement.querySelector('#testnet-gateway-start') as HTMLButtonElement).click();
    f.detectChanges();
    const starting = f.nativeElement.querySelector('#testnet-gateway-start') as HTMLButtonElement;
    expect(starting.disabled).toBe(true);
    expect(starting.textContent).toContain('Starting');
    expect(f.nativeElement.querySelector('#testnet-gateway-stop')).toBeNull();
    starting.click();
    expect(calls).toBe(1);
    release({ ok: true });
    await f.whenStable();
  });

  it('shows House Prime as an opt-in form when the extra is present', async () => {
    const f = await render('desktop', { node: false, gateway: true, pool: true });
    expect(f.nativeElement.querySelector('#testnet-gateway-prime-host')).toBeTruthy();
    expect(f.nativeElement.textContent).toMatch(/opt-in/i);
    expect(f.nativeElement.querySelector('#testnet-gateway-prime-pub')).toBeTruthy();
    expect(f.nativeElement.querySelector('#testnet-gateway-keys-url')).toBeNull();
    const cmp = f.componentInstance as unknown as {
      deskForm: { controls: { primeIdentity: { setValue: (v: string) => void } } };
    };
    cmp.deskForm.controls.primeIdentity.setValue('url');
    f.detectChanges();
    expect(f.nativeElement.querySelector('#testnet-gateway-keys-url')).toBeTruthy();
    expect(f.nativeElement.querySelector('#testnet-gateway-prime-pub')).toBeNull();
  });

  it('shows the fetched keys document on the URL partition', async () => {
    const ed = 'ab'.repeat(32);
    const x = 'cd'.repeat(32);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [GatewayPane],
      providers: [
        provideAnimations(),
        {
          provide: HASHER_HOST,
          useValue: {
            ...host({ node: false, gateway: true, pool: true }),
            fetchPrimeKeys: async () => ({ ok: true, text: JSON.stringify({ ed25519: ed, x25519: x }) }),
          },
        },
        { provide: MINER_SHELL, useValue: desktopShell() },
        ExtrasService,
      ],
    }).compileComponents();
    await TestBed.inject(ExtrasService).refresh();
    const f = TestBed.createComponent(GatewayPane);
    f.componentRef.setInput('chain', 'testnet');
    f.detectChanges();
    await f.whenStable();
    const cmp = f.componentInstance as unknown as {
      deskForm: { controls: { primeIdentity: { setValue: (v: string) => void }; keysUrl: { setValue: (v: string) => void } } };
      fetchKeys: () => Promise<void>;
    };
    cmp.deskForm.controls.primeIdentity.setValue('url');
    cmp.deskForm.controls.keysUrl.setValue('https://pool.example/keys.json');
    f.detectChanges();
    await cmp.fetchKeys();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(ed + x);
  });
});
