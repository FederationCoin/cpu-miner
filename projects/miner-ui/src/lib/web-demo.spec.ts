import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import type { GpuScan, MinerInfo, MinerStartOpts, MinerStats, PoolStats } from './miner-api';
import { FinderPane } from './finder-pane';
import { MINER_SHELL, webDemoShell } from './miner-shell';
import { IDLE_STATS } from './mining.service';
import { NetworkWorkspace } from './network-workspace';
import { IDLE_POOL_STATS } from './pool.service';

@Component({
  imports: [NetworkWorkspace],
  template: `<app-network-workspace chain="testnet" />`,
})
class WebDemoHost {}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

function fakeWebHost(overrides: Partial<HasherHost> = {}): HasherHost {
  let statsCb: ((s: MinerStats) => void) | undefined;
  const info: MinerInfo = {
    cookiePath: '',
    datadir: '',
    rpc: '',
    electron: false,
    defaultThreads: 4,
  };
  return {
    canMine: true,
    inElectron: false,
    start: async (opts: MinerStartOpts) => {
      statsCb?.({ ...IDLE_STATS, running: true, chain: opts.chain, status: 'starting' });
      return { ok: true };
    },
    stop: async () => {
      statsCb?.({ ...IDLE_STATS });
    },
    info: async () => info,
    gpus: async () => ({ devices: [], addon: false }),
    pickDatadir: async () => null,
    onStats: (cb) => {
      statsCb = cb;
      return () => {
        if (statsCb === cb) {
          statsCb = undefined;
        }
      };
    },
    onToast: () => () => undefined,
    poolStart: async () => ({ ok: false, error: 'The cloud pool is already running. Settings are not editable here.' }),
    poolStop: async () => undefined,
    onPoolStats: (cb) => {
      const hosted: PoolStats = {
        ...IDLE_POOL_STATS,
        running: true,
        chain: 'testnet',
        status: 'hosted',
        stratumHost: 'stratum.testnet.federationcoin.org',
        stratumPort: 23334,
      };
      cb(hosted);
      return () => undefined;
    },
    miningSocketOpen: () => false,
    requestGatewayPoolInfo: () => false,
    fetchGatewayPoolInfo: async () => ({ kind: 'notProvided' as const }),
    onGatewayPoolInfo: () => () => undefined,
    ...overrides,
  };
}

describe('web demo shell', () => {
  let fixture: ComponentFixture<WebDemoHost> | undefined;
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

  beforeEach(async () => {
    Object.defineProperty(window, 'localStorage', {
      value: memoryStorage(),
      configurable: true,
    });
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    TestBed.resetTestingModule();
    if (localStorageDescriptor) {
      Object.defineProperty(window, 'localStorage', localStorageDescriptor);
    }
  });

  async function render(host: HasherHost = fakeWebHost()): Promise<ComponentFixture<WebDemoHost>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [WebDemoHost],
      providers: [
        provideAnimations(),
        { provide: MINER_SHELL, useValue: webDemoShell() },
        { provide: HASHER_HOST, useValue: host },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(WebDemoHost);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function has(f: ComponentFixture<WebDemoHost>, selector: string): boolean {
    return f.debugElement.query(By.css(selector)) != null;
  }

  function clickRadio(f: ComponentFixture<WebDemoHost>, selector: string): void {
    const host = f.nativeElement.querySelector(selector) as HTMLElement | null;
    expect(host).toBeTruthy();
    const input =
      host instanceof HTMLInputElement ? host : (host!.querySelector('input[type="radio"]') as HTMLInputElement | null);
    expect(input).toBeTruthy();
    input!.click();
    f.detectChanges();
  }

  function radioOn(selector: string, f: ComponentFixture<WebDemoHost>): boolean {
    const host = f.nativeElement.querySelector(selector) as HTMLElement | null;
    if (!host) {
      return false;
    }
    const input =
      host instanceof HTMLInputElement ? host : (host.querySelector('input[type="radio"]') as HTMLInputElement | null);
    return !!input?.checked || host.classList.contains('mat-mdc-radio-checked');
  }

  it('offers two web Stratum WebSocket kinds and no house pool shortcut', async () => {
    const f = await render();
    expect(has(f, '#testnet-mineToStratumPoolWebsocket')).toBe(true);
    expect(has(f, '#testnet-mineToDatumGatewayWebsocket')).toBe(true);
    expect(has(f, '#testnet-mineToHostedPoolStratum')).toBe(false);
    expect(has(f, '#testnet-mineToAppPoolStratum')).toBe(false);
    expect(has(f, '#testnet-mineToAppPoolDatum')).toBe(false);
    expect(has(f, '#testnet-mineToNode')).toBe(false);
    expect(has(f, '#testnet-mineToStratum')).toBe(false);
    expect((f.nativeElement.querySelector('#testnet-stratumPoolWebsocketUrl') as HTMLInputElement).value).toBe('');
  });

  it('shows WebGPU Help when no adapters are listed', async () => {
    const f = await render();
    expect(has(f, '#testnet-webgpuHelp')).toBe(true);
    const help = f.nativeElement.querySelector('#testnet-webgpuHelp') as HTMLButtonElement;
    help.click();
    f.detectChanges();
    const dlg = f.nativeElement.querySelector('#testnet-webgpuHelpDialog') as HTMLDialogElement;
    expect(dlg.open || dlg.hasAttribute('open')).toBe(true);
    expect(dlg.textContent).toMatch(/chrome:\/\/gpu/);
    expect(dlg.textContent).toMatch(/enable-unsafe-webgpu/);
    expect(dlg.textContent).toMatch(/ignore-gpu-blocklist/);
    expect(dlg.textContent).toMatch(/Software only/);
    expect(dlg.textContent).toMatch(/developer\.chrome\.com/);
  });

  it('opens the WebGPU dialog after Detect finds no adapter', async () => {
    const gpus = vi.fn<(this: void) => Promise<GpuScan>>().mockResolvedValue({
      devices: [],
      addon: false,
    });
    const f = await render(fakeWebHost({ gpus }));
    const dlg = () => f.nativeElement.querySelector('#testnet-webgpuHelpDialog') as HTMLDialogElement;
    expect(dlg().open || dlg().hasAttribute('open')).toBe(false);
    (f.nativeElement.querySelector('#testnet-detectGpus') as HTMLButtonElement).click();
    await f.whenStable();
    f.detectChanges();
    expect(gpus).toHaveBeenCalled();
    expect(dlg().open || dlg().hasAttribute('open')).toBe(true);
  });

  it('hides WebGPU Help after an adapter is listed', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');
    Object.defineProperty(globalThis.navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => ({ info: { device: 'WebGPU adapter', vendor: 'webgpu' } }),
      },
    });
    try {
      const f = await render();
      (f.nativeElement.querySelector('#testnet-detectGpus') as HTMLButtonElement).click();
      await f.whenStable();
      f.detectChanges();
      expect(has(f, '#testnet-gpu-webgpu-adapter-off')).toBe(true);
      expect(has(f, '#testnet-gpu-webgpu-adapter-webgpu')).toBe(true);
      expect(has(f, '#testnet-gpu-webgpu-adapter-cuda')).toBe(false);
      expect(has(f, '#testnet-gpu-webgpu-adapter-opencl')).toBe(false);
      expect(has(f, '#testnet-webgpuHelp')).toBe(false);
    } finally {
      if (previous) {
        Object.defineProperty(globalThis.navigator, 'gpu', previous);
      } else {
        delete (globalThis.navigator as { gpu?: unknown }).gpu;
      }
    }
  });

  it('shows an idle Stratum link pill', async () => {
    const f = await render();
    const pill = f.nativeElement.querySelector('#testnet-link') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.getAttribute('data-link')).toBe('idle');
    expect(pill.textContent).toContain('Stratum idle');
  });

  it('shows gateway WebSocket fields with a localhost prefill, not a house pool', async () => {
    const f = await render();
    clickRadio(f, '#testnet-mineToDatumGatewayWebsocket');
    f.detectChanges();
    expect(has(f, '#testnet-datumGatewayWebsocketUrl')).toBe(true);
    expect((f.nativeElement.querySelector('#testnet-datumGatewayWebsocketUrl') as HTMLInputElement).value).toBe(
      'ws://127.0.0.1:23335/stratum',
    );
    expect(f.nativeElement.textContent).toMatch(/not the DATUM Prime Pool/);
    expect(has(f, '#testnet-gatewayLoopbackWarning')).toBe(true);
    expect(has(f, '#testnet-pool-info-fetch')).toBe(true);
    expect(f.nativeElement.textContent).toMatch(/Not yet requested/);
    const url = f.nativeElement.querySelector('#testnet-datumGatewayWebsocketUrl') as HTMLInputElement;
    url.value = 'wss://pool.example/stratum';
    url.dispatchEvent(new Event('input', { bubbles: true }));
    f.detectChanges();
    expect(has(f, '#testnet-gatewayLoopbackWarning')).toBe(false);
  });

  it('shows notProvided then provided pool info from Fetch', async () => {
    let n = 0;
    const f = await render(
      fakeWebHost({
        fetchGatewayPoolInfo: async () => {
          n += 1;
          if (n === 1) {
            return { kind: 'notProvided' };
          }
          return {
            kind: 'provided',
            fields: { prime: 'prime.example:28916', name: 'House', coinbaseTag: 'TAG', websiteUrl: '' },
          };
        },
      }),
    );
    clickRadio(f, '#testnet-mineToDatumGatewayWebsocket');
    f.detectChanges();
    (f.nativeElement.querySelector('#testnet-pool-info-fetch') as HTMLButtonElement).click();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toMatch(/Gateway is not providing pool info/);
    expect(has(f, '#testnet-pool-info-refresh')).toBe(true);
    expect(has(f, '#testnet-pool-info-fetch')).toBe(false);
  });

  it('shows provided pool info with DATUM Prime Pool host', async () => {
    const f = await render(
      fakeWebHost({
        fetchGatewayPoolInfo: async () => ({
          kind: 'provided',
          fields: { prime: 'prime.example:28916', name: 'House', coinbaseTag: 'TAG', websiteUrl: 'https://ex.example' },
        }),
      }),
    );
    clickRadio(f, '#testnet-mineToDatumGatewayWebsocket');
    f.detectChanges();
    (f.nativeElement.querySelector('#testnet-pool-info-fetch') as HTMLButtonElement).click();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toMatch(/Gateway published pool info/);
    expect(f.nativeElement.textContent).toMatch(/DATUM Prime Pool/);
    expect(f.nativeElement.textContent).toMatch(/prime.example:28916/);
    expect(f.nativeElement.textContent).toMatch(/House/);
    expect(has(f, '#testnet-pool-info-refresh')).toBe(true);
  });

  it('migrates a saved Stratum kind to pool WebSocket without a house URL', async () => {
    localStorage.setItem('fc.testnet.kind', 'stratum');
    localStorage.setItem('fc.testnet.stratum.host', 'stratum.testnet.federationcoin.org');
    localStorage.setItem('fc.testnet.stratum.port', '23334');
    const f = await render();
    expect(has(f, '#testnet-mineToStratum')).toBe(false);
    expect(radioOn('#testnet-mineToStratumPoolWebsocket', f)).toBe(true);
    expect((f.nativeElement.querySelector('#testnet-stratumPoolWebsocketUrl') as HTMLInputElement).value).toBe('');
    expect(localStorage.getItem('fc.testnet.kind')).toBe('stratumPoolWebsocket');
  });

  it('migrates a saved nested Stratum Websocket URL onto the pool kind', async () => {
    localStorage.setItem('fc.testnet.kind', 'stratumWebsocket');
    localStorage.setItem('fc.testnet.stratumWebsocket.url', 'wss://legacy.example/stratum');
    localStorage.setItem('fc.testnet.stratumWebsocket.worker', 'tgfcn1legacy.cpu');
    const f = await render();
    expect((f.nativeElement.querySelector('#testnet-stratumPoolWebsocketUrl') as HTMLInputElement).value).toBe(
      'wss://legacy.example/stratum',
    );
    expect((f.nativeElement.querySelector('#testnet-stratumPoolWebsocketWorker') as HTMLInputElement).value).toBe(
      'tgfcn1legacy.cpu',
    );
  });

  it('hides Host a pool on the web mill and splits Finder', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/v1/sign-context')) {
        return new Response(
          JSON.stringify({
            signingBlockHeight: 10,
            signingBlockHash: 'ab'.repeat(32),
            stakeRequiredSats: '1',
            mineSeconds: 3600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ groups: [], items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const f = await render();
      expect(has(f, '#testnet-tab-pool')).toBe(false);
      (f.nativeElement.querySelector('#testnet-tab-finder') as HTMLButtonElement).click();
      await f.whenStable();
      f.detectChanges();
      expect(has(f, '#testnet-finder-listings')).toBe(true);
      expect(has(f, '#testnet-finder-register-pane')).toBe(true);
      expect(has(f, '#testnet-finder-refresh-tip')).toBe(true);
      expect(has(f, '#testnet-finder-attest-dialog')).toBe(true);
      expect(f.nativeElement.querySelector('[id^="testnet-finder-target-"]')).toBeNull();
      expect(f.nativeElement.textContent).toMatch(/Mine this sits next to Stratum only/);
      expect(f.nativeElement.textContent).not.toMatch(/House pool stays on Pool/);
      const finder = f.debugElement.query(By.directive(FinderPane)).componentInstance as FinderPane;
      expect([...finder.listingKinds]).toEqual(['stratum', 'stratumWs', 'datumPrime']);
      expect(finder.listingKinds).not.toContain('datumPrimeWs');
      expect(f.nativeElement.textContent).toMatch(/DATUM Prime Pool is TCP for your gateway/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Find Mine this fills pool WebSocket and shows Prime as a side card', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/v1/sign-context')) {
        return new Response(
          JSON.stringify({
            signingBlockHeight: 10,
            signingBlockHash: 'ab'.repeat(32),
            stakeRequiredSats: '1',
            mineSeconds: 3600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              poolId: 'web-both',
              chain: 'testnet',
              operatorWallet: 'tgfcn1qw508d6qejxtdg4y5r3zarvary0c5xw7k',
              name: 'WSS mill',
              websiteUrl: 'https://pool.example.com',
              connect: {
                kind: 'stratumAndDatum',
                stratum: { host: 's.example.com', port: 23334 },
                datum: { host: 'd.example.com', port: 28916 },
                wss: { host: 'pool.example.com', path: '/stratum' },
              },
              coinbaseTag: 'w',
              listingDomain: 'pool.example.com',
              attestationCount: 0,
              listerConfirmedCoinbasePayee: false,
              reviewScore: 0,
              hasHostileFlag: false,
            },
            {
              poolId: 'web-prime',
              chain: 'testnet',
              operatorWallet: 'tgfcn1qw508d6qejxtdg4y5r3zarvary0c5xw7k',
              name: 'Prime listing',
              websiteUrl: 'https://prime.example.com',
              connect: { kind: 'datumOnly', datum: { host: 'prime.example.com', port: 28916 } },
              coinbaseTag: 'p',
              listingDomain: 'prime.example.com',
              attestationCount: 0,
              listerConfirmedCoinbasePayee: false,
              reviewScore: 0,
              hasHostileFlag: false,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    try {
      const f = await render();
      (f.nativeElement.querySelector('#testnet-tab-finder') as HTMLButtonElement).click();
      await f.whenStable();
      f.detectChanges();
      await vi.waitFor(() => {
        f.detectChanges();
        expect(f.nativeElement.textContent).toContain('WSS mill');
      });
      expect(has(f, '#testnet-finder-target-web-both')).toBe(true);
      expect(has(f, '#testnet-finder-prime-web-both')).toBe(true);
      expect(has(f, '#testnet-finder-target-web-prime')).toBe(false);
      expect(has(f, '#testnet-finder-prime-web-prime')).toBe(true);
      (f.nativeElement.querySelector('#testnet-finder-target-web-both') as HTMLButtonElement).click();
      await f.whenStable();
      f.detectChanges();
      expect((f.nativeElement.querySelector('#testnet-stratumPoolWebsocketUrl') as HTMLInputElement).value).toBe(
        'wss://pool.example.com/stratum',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('How to mine lead has no hasher-never-DATUM or Apps On Device caption', async () => {
    const f = await render();
    (f.nativeElement.querySelector('#testnet-tab-docs') as HTMLButtonElement).click();
    f.detectChanges();
    const lead = f.nativeElement.querySelector('[data-how-to-mine]') as HTMLElement;
    expect(lead).toBeTruthy();
    expect(lead.textContent).not.toMatch(/hasher never speaks DATUM/i);
    expect(lead.textContent).not.toMatch(/Apps On Device/);
    expect(f.nativeElement.textContent).toMatch(/DATUM Prime Pool/);
    expect(f.nativeElement.textContent).toMatch(/Pool registration, stake, and attestation/);
    const img = f.nativeElement.querySelector('img[src="docs/mill-web.svg"]') as HTMLImageElement;
    expect(img.alt).toMatch(/DATUM Prime Pool/);
    expect(img.alt).not.toMatch(/hasher never/i);
  });
});
