import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import type { GpuDevice, GpuScan, MinerInfo, MinerStartOpts, MinerStats, PoolStats } from './miner-api';
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
    gpus: async () => ({ devices: [], addon: false, reason: 'no-adapter' }),
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

  it('does not show App pool radios when hosted pool stats are running', async () => {
    const f = await render();
    expect(has(f, '#testnet-mineToHostedPoolStratum')).toBe(true);
    expect(has(f, '#testnet-mineToAppPoolStratum')).toBe(false);
    expect(has(f, '#testnet-mineToAppPoolDatum')).toBe(false);
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
      reason: 'no-adapter',
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
    const device: GpuDevice = {
      id: 'webgpu:0',
      name: 'WebGPU adapter',
      vendor: 'webgpu',
      memoryMiB: 0,
      backend: 'webgpu',
      kind: 'discrete',
    };
    const f = await render(
      fakeWebHost({
        gpus: async () => ({ devices: [device], addon: true, reason: 'ok' }),
      }),
    );
    (f.nativeElement.querySelector('#testnet-detectGpus') as HTMLButtonElement).click();
    await f.whenStable();
    f.detectChanges();
    expect(has(f, '#testnet-gpu-webgpu-0')).toBe(true);
    expect(has(f, '#testnet-webgpuHelp')).toBe(false);
  });

  it('shows an idle Stratum link pill', async () => {
    const f = await render();
    const pill = f.nativeElement.querySelector('#testnet-link') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.getAttribute('data-link')).toBe('idle');
    expect(pill.textContent).toContain('Stratum idle');
  });

  it('defaults Stratum to the WebSocket host on 443', async () => {
    const f = await render();
    (f.nativeElement.querySelector('#testnet-mineToStratum') as HTMLInputElement).click();
    f.detectChanges();
    expect((f.nativeElement.querySelector('#testnet-stratumHost') as HTMLInputElement).value).toBe(
      'pool.testnet.federationcoin.org',
    );
    expect((f.nativeElement.querySelector('#testnet-stratumPort') as HTMLInputElement).value).toBe('443');
  });

  it('replaces a saved TCP NLB Stratum default with the WebSocket port', async () => {
    localStorage.setItem('fc.testnet.stratum.host', 'stratum.testnet.federationcoin.org');
    localStorage.setItem('fc.testnet.stratum.port', '23334');
    const f = await render();
    (f.nativeElement.querySelector('#testnet-mineToStratum') as HTMLInputElement).click();
    f.detectChanges();
    expect((f.nativeElement.querySelector('#testnet-stratumHost') as HTMLInputElement).value).toBe(
      'pool.testnet.federationcoin.org',
    );
    expect((f.nativeElement.querySelector('#testnet-stratumPort') as HTMLInputElement).value).toBe('443');
  });
});
