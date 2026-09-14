import { DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { App } from './app';
import { IDLE_STATS } from './mining.service';
import type { MinerApi, MinerInfo, MinerStartOpts, MinerStats, PoolStartOpts, PoolStats } from '../miner-api';

const electronInfo: MinerInfo = {
  cookiePath: '/tmp/x/testnet3/.cookie',
  datadir: '/tmp/x',
  rpc: '127.0.0.1:35332',
  electron: true,
  defaultThreads: 4,
};

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

function stubMiner(overrides: Partial<MinerApi> = {}): MinerApi {
  let statsCb: ((s: MinerStats) => void) | undefined;
  let poolCb: ((s: PoolStats) => void) | undefined;
  const api: MinerApi = {
    start: vi.fn(async (opts: MinerStartOpts) => {
      statsCb?.({
        ...IDLE_STATS,
        running: true,
        chain: opts.chain,
        status: 'starting',
      });
      return { ok: true };
    }),
    stop: vi.fn(async () => {
      statsCb?.({ ...IDLE_STATS });
    }),
    gpus: vi.fn().mockResolvedValue({ devices: [], addon: false }),
    pickDatadir: vi.fn().mockResolvedValue(null),
    logHistory: vi.fn().mockResolvedValue([]),
    info: vi.fn().mockResolvedValue(electronInfo),
    onStats: vi.fn((cb) => {
      statsCb = cb;
      return () => {
        if (statsCb === cb) {
          statsCb = undefined;
        }
      };
    }),
    onLog: vi.fn().mockReturnValue(() => undefined),
    onToast: vi.fn().mockReturnValue(() => undefined),
    poolStart: vi.fn(async (opts: PoolStartOpts) => {
      poolCb?.({
        running: true,
        chain: opts.chain,
        height: 0,
        workers: 0,
        accepted: 0,
        rejected: 0,
        lastError: '',
        status: 'starting',
        stratumPort: opts.stratumPort,
        datumPort: opts.datumPort,
      });
      return { ok: true };
    }),
    poolStop: vi.fn(async () => {
      poolCb?.({
        running: false,
        chain: null,
        height: 0,
        workers: 0,
        accepted: 0,
        rejected: 0,
        lastError: '',
        status: 'stopped',
        stratumPort: 0,
        datumPort: 0,
      });
    }),
    onPoolStats: vi.fn((cb) => {
      poolCb = cb;
      return () => {
        if (poolCb === cb) {
          poolCb = undefined;
        }
      };
    }),
    ...overrides,
  };
  return api;
}

function queryDe(fixture: ComponentFixture<App>, selector: string): DebugElement {
  const de = fixture.debugElement.query(By.css(selector));
  expect(de, `expected ${selector}`).toBeTruthy();
  return de;
}

function queryEl<T extends HTMLElement>(fixture: ComponentFixture<App>, selector: string): T {
  return queryDe(fixture, selector).nativeElement as T;
}

function has(fixture: ComponentFixture<App>, selector: string): boolean {
  return fixture.debugElement.query(By.css(selector)) != null;
}

function setInput(fixture: ComponentFixture<App>, selector: string, value: string): void {
  queryDe(fixture, selector).triggerEventHandler('input', { target: { value } });
  fixture.detectChanges();
}

function selectMode(fixture: ComponentFixture<App>, chain: 'main' | 'testnet', mode: 'rpc' | 'stratum'): void {
  queryDe(fixture, `#${chain}-mode${mode === 'stratum' ? 'Stratum' : 'Rpc'}`).triggerEventHandler('change');
  fixture.detectChanges();
}

function selectTab(fixture: ComponentFixture<App>, chain: 'main' | 'testnet' | 'pool'): void {
  queryDe(fixture, `#tab-${chain}`).triggerEventHandler('click');
  fixture.detectChanges();
}

describe('App', () => {
  let fixture: ComponentFixture<App> | undefined;
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

  beforeEach(async () => {
    Object.defineProperty(window, 'localStorage', {
      value: memoryStorage(),
      configurable: true,
    });
    delete window.miner;
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    delete window.miner;
    TestBed.resetTestingModule();
    if (localStorageDescriptor) {
      Object.defineProperty(window, 'localStorage', localStorageDescriptor);
    }
  });

  async function render(miner?: MinerApi): Promise<ComponentFixture<App>> {
    if (miner) {
      window.miner = miner;
    } else {
      delete window.miner;
    }
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  describe('without Electron', () => {
    it('creates and shows the heading', async () => {
      const f = await render();
      expect(f.componentInstance).toBeTruthy();
      expect(queryEl(f, 'h1').textContent).toContain('FederationCoin CPU miner');
    });

    it('defaults to the Main tab with the not-live warning', async () => {
      const f = await render();
      expect(queryEl(f, '#tab-main').getAttribute('aria-selected')).toBe('true');
      expect(queryEl(f, '#panel-main').hidden).toBe(false);
      expect(queryEl(f, '#panel-testnet').hidden).toBe(true);
      expect(has(f, '[data-main-warning]')).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#main-payout').placeholder).toContain('gfcn1');
      expect(queryEl<HTMLInputElement>(f, '#main-port').value).toBe('4094');
      expect(queryEl<HTMLButtonElement>(f, '#main-start').disabled).toBe(true);
      expect(queryEl<HTMLButtonElement>(f, '#main-stop').disabled).toBe(true);
    });

    it('shows Testnet fields after switching tabs', async () => {
      const f = await render();
      selectTab(f, 'testnet');
      expect(queryEl(f, '#panel-testnet').hidden).toBe(false);
      expect(queryEl(f, '#panel-main').hidden).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#testnet-modeRpc').checked).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#testnet-payout').placeholder).toContain('tgfcn1');
      expect(queryEl<HTMLInputElement>(f, '#testnet-port').value).toBe('35332');
      expect(queryEl(f, '.warn').textContent).toContain('cpu-miner/');
    });
  });

  describe('with Electron', () => {
    it('hides the ng-serve warning and enables Start on Main', async () => {
      const f = await render(stubMiner());
      expect(queryEl(f, '.warn').textContent).toContain('Main is not live');
      expect(queryEl<HTMLButtonElement>(f, '#main-start').disabled).toBe(false);
      expect(queryEl<HTMLButtonElement>(f, '#main-stop').disabled).toBe(true);
    });

    it('shows worker and password after switching Testnet to Stratum', async () => {
      const f = await render(stubMiner());
      selectTab(f, 'testnet');
      selectMode(f, 'testnet', 'stratum');
      expect(has(f, '#testnet-worker')).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#testnet-password').type).toBe('password');
      expect(has(f, '#testnet-payout')).toBe(false);
      expect(has(f, '#testnet-datadir')).toBe(false);
      expect(has(f, '#wslMode')).toBe(false);
      expect(queryEl<HTMLInputElement>(f, '#testnet-port').value).toBe('23334');
    });

    it('persists Testnet Stratum mode across a remount', async () => {
      const miner = stubMiner();
      const first = await render(miner);
      selectTab(first, 'testnet');
      selectMode(first, 'testnet', 'stratum');
      first.destroy();
      const second = await render(miner);
      selectTab(second, 'testnet');
      expect(queryEl<HTMLInputElement>(second, '#testnet-modeStratum').checked).toBe(true);
      expect(has(second, '#testnet-worker')).toBe(true);
    });

    it('Start in Testnet Stratum sends chain and stratum fields', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      selectTab(f, 'testnet');
      selectMode(f, 'testnet', 'stratum');
      setInput(f, '#testnet-worker', 'tgfcn1abc.cpu');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        chain: 'testnet',
        mode: 'stratum',
        threads: 4,
        gpuIds: [],
        host: '127.0.0.1',
        port: 23334,
        worker: 'tgfcn1abc.cpu',
        password: 'x',
      });
    });

    it('shows a GPUs fieldset', async () => {
      const f = await render(stubMiner());
      expect(has(f, '#main-gpus')).toBe(true);
      expect(queryEl(f, '#main-gpus').textContent).toMatch(/OpenCL/);
    });

    it('Detect GPUs reports when the hasher addon is missing', async () => {
      const gpus = vi.fn().mockResolvedValue({ devices: [], addon: false });
      const f = await render(stubMiner({ gpus }));
      queryDe(f, '#main-detectGpus').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      expect(gpus).toHaveBeenCalled();
      expect(queryEl(f, '#main-gpus').textContent).toMatch(/No GPU hasher/);
    });

    it('Start in Main RPC sends gfcn payout and dummy RPC port', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      setInput(f, '#main-payout', 'gfcn1qqq');
      queryDe(f, '#main-start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        chain: 'main',
        mode: 'rpc',
        threads: 4,
        gpuIds: [],
        host: '127.0.0.1',
        port: 4094,
        payout: 'gfcn1qqq',
        datadir: '/tmp/x',
      });
    });

    it('Stop is enabled only on the mining pane', async () => {
      const f = await render(stubMiner());
      setInput(f, '#main-payout', 'gfcn1qqq');
      queryDe(f, '#main-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      expect(queryEl<HTMLButtonElement>(f, '#main-start').disabled).toBe(true);
      expect(queryEl<HTMLButtonElement>(f, '#main-stop').disabled).toBe(false);
      selectTab(f, 'testnet');
      expect(queryEl<HTMLButtonElement>(f, '#testnet-start').disabled).toBe(false);
      expect(queryEl<HTMLButtonElement>(f, '#testnet-stop').disabled).toBe(true);
      expect(queryEl(f, '[data-other-mining]').textContent).toContain('Main');
    });

    it('Start on Testnet while Main is mining calls stop then start', async () => {
      const miner = stubMiner();
      const f = await render(miner);
      setInput(f, '#main-payout', 'gfcn1qqq');
      queryDe(f, '#main-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      selectTab(f, 'testnet');
      selectMode(f, 'testnet', 'stratum');
      setInput(f, '#testnet-worker', 'tgfcn1abc.cpu');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      expect(miner.stop).toHaveBeenCalled();
      expect(miner.start).toHaveBeenCalledTimes(2);
      expect(miner.start).toHaveBeenLastCalledWith(
        expect.objectContaining({ chain: 'testnet', mode: 'stratum', worker: 'tgfcn1abc.cpu' }),
      );
    });

    it('shows a start error from the main process', async () => {
      const start = vi.fn().mockResolvedValue({ ok: false, error: 'worker is empty' });
      const f = await render(stubMiner({ start }));
      selectTab(f, 'testnet');
      selectMode(f, 'testnet', 'stratum');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      expect(queryEl(f, '.err').textContent).toContain('worker is empty');
    });

    it('shows a toast from the main process', async () => {
      let sendToast: ((message: string) => void) | undefined;
      const f = await render(
        stubMiner({
          onToast: (cb) => {
            sendToast = cb;
            return () => undefined;
          },
        }),
      );
      sendToast?.('ECONNREFUSED 127.0.0.1:35332');
      f.detectChanges();
      expect(queryEl(f, '[role="status"]').textContent).toContain('ECONNREFUSED');
    });

    it('places Host a pool after Main and Testnet', async () => {
      const f = await render(stubMiner());
      const tabs = f.debugElement.queryAll(By.css('[role="tab"]')).map((d) => (d.nativeElement as HTMLElement).id);
      expect(tabs).toEqual(['tab-main', 'tab-testnet', 'tab-pool']);
      expect(queryEl(f, '#panel-pool').hidden).toBe(true);
      selectTab(f, 'pool');
      expect(queryEl(f, '#panel-pool').hidden).toBe(false);
      expect(queryEl(f, '#panel-testnet').hidden).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#pool-chainTestnet').checked).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#pool-stratumPort').value).toBe('23334');
      expect(queryEl<HTMLInputElement>(f, '#pool-datumPort').value).toBe('28916');
    });

    it('Start on Host a pool sends spawn IPC without a cookie', async () => {
      const poolStart = vi.fn<(opts: PoolStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ poolStart }));
      selectTab(f, 'pool');
      setInput(f, '#pool-operator', 'tgfcn1abc');
      queryDe(f, '#pool-start').triggerEventHandler('click');
      await f.whenStable();
      expect(poolStart).toHaveBeenCalledWith({
        chain: 'testnet',
        rpcHost: '127.0.0.1',
        rpcPort: 35332,
        datadir: '/tmp/x',
        operator: 'tgfcn1abc',
        feeBps: 200,
        stratumHost: '127.0.0.1',
        stratumPort: 23334,
        datumHost: '127.0.0.1',
        datumPort: 28916,
      });
      expect(JSON.stringify(poolStart.mock.calls[0]?.[0])).not.toMatch(/cookie/i);
    });

    it('Stop on Host a pool calls poolStop', async () => {
      const miner = stubMiner();
      const f = await render(miner);
      selectTab(f, 'pool');
      setInput(f, '#pool-operator', 'tgfcn1abc');
      queryDe(f, '#pool-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      expect(queryEl<HTMLButtonElement>(f, '#pool-stop').disabled).toBe(false);
      queryDe(f, '#pool-stop').triggerEventHandler('click');
      await f.whenStable();
      expect(miner.poolStop).toHaveBeenCalled();
    });

    it('Host a pool Main warning stays not-live', async () => {
      const f = await render(stubMiner());
      selectTab(f, 'pool');
      queryDe(f, '#pool-chainMain').triggerEventHandler('change');
      f.detectChanges();
      expect(has(f, '[data-pool-main-warning]')).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#pool-operator').placeholder).toContain('gfcn1');
    });
  });
});
