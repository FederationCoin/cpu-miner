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
        stratumHost: opts.stratumHost,
        stratumPort: opts.stratumPort,
        datumHost: opts.datumHost,
        datumPort: opts.datumPort,
        payouts: [],
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
        stratumHost: '',
        stratumPort: 0,
        datumHost: '',
        datumPort: 0,
        payouts: [],
      });
    }),
    poolRefresh: vi.fn(async () => ({ ok: true })),
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
  const el = queryEl<HTMLInputElement>(fixture, selector);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.detectChanges();
}

function selectNetwork(fixture: ComponentFixture<App>, id: 'main' | 'testnet'): void {
  const el = queryEl<HTMLSelectElement>(fixture, '#network-toggle');
  el.value = id;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  fixture.detectChanges();
}

function selectKind(fixture: ComponentFixture<App>, chain: 'main' | 'testnet', kind: string): void {
  const el = queryEl<HTMLInputElement>(fixture, `#${chain}-mineTo${kind}`);
  el.click();
  fixture.detectChanges();
}

function selectAuth(fixture: ComponentFixture<App>, prefix: string, kind: 'Cookie' | 'Userpass'): void {
  const el = queryEl<HTMLInputElement>(fixture, `#${prefix}-auth${kind}`);
  el.click();
  fixture.detectChanges();
}

function cookieRpc(datadir: string, host = '127.0.0.1', port = 35332) {
  return { host, port, auth: { kind: 'cookie' as const, datadir } };
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

    it('defaults to Testnet with both mining and pool panes', async () => {
      const f = await render();
      expect(queryEl<HTMLSelectElement>(f, '#network-toggle').value).toBe('testnet');
      expect(queryEl(f, '[data-chain="testnet"]').hidden).toBe(false);
      expect(queryEl(f, '[data-chain="main"]').hidden).toBe(true);
      expect(has(f, '[data-chain="testnet"] [data-main-warning]')).toBe(false);
      expect(queryEl<HTMLInputElement>(f, '#testnet-payout').placeholder).toContain('tgfcn1');
      expect(queryEl<HTMLInputElement>(f, '#testnet-rpcPort').value).toBe('35332');
      expect(queryEl<HTMLButtonElement>(f, '#testnet-start').disabled).toBe(true);
      expect(queryEl<HTMLButtonElement>(f, '#testnet-stop').disabled).toBe(true);
      expect(has(f, '#testnet-pool-operator')).toBe(true);
    });

    it('shows Main warning after switching the network toggle', async () => {
      const f = await render();
      selectNetwork(f, 'main');
      expect(queryEl(f, '[data-chain="main"]').hidden).toBe(false);
      expect(has(f, '[data-chain="main"] [data-main-warning]')).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#main-payout').placeholder).toContain('gfcn1');
      expect(queryEl<HTMLInputElement>(f, '#main-rpcPort').value).toBe('4094');
      expect(queryEl(f, '.warn').textContent).toContain('cpu-miner/');
    });
  });

  describe('with Electron', () => {
    it('hides the ng-serve warning and enables Start on Testnet', async () => {
      const f = await render(stubMiner());
      expect(queryEl(f, '.warn').textContent).not.toContain('cpu-miner/');
      expect(queryEl<HTMLButtonElement>(f, '#testnet-start').disabled).toBe(false);
      expect(queryEl<HTMLButtonElement>(f, '#testnet-stop').disabled).toBe(true);
    });

    it('shows Stratum worker and password after switching mine-to', async () => {
      const f = await render(stubMiner());
      selectKind(f, 'testnet', 'Stratum');
      expect(has(f, '#testnet-stratumWorker')).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#testnet-stratumPassword').type).toBe('password');
      expect(has(f, '#testnet-payout')).toBe(false);
      expect(has(f, '#testnet-datadir')).toBe(false);
      expect(queryEl<HTMLInputElement>(f, '#testnet-stratumPort').value).toBe('23334');
    });

    it('shows cookie datadir by default and username/password after the auth toggle', async () => {
      const f = await render(stubMiner());
      expect(queryEl<HTMLInputElement>(f, '#testnet-authCookie').checked).toBe(true);
      expect(has(f, '#testnet-datadir')).toBe(true);
      expect(has(f, '#testnet-rpcUser')).toBe(false);
      selectAuth(f, 'testnet', 'Userpass');
      expect(has(f, '#testnet-datadir')).toBe(false);
      expect(has(f, '#testnet-rpcUser')).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#testnet-rpcPassword').type).toBe('password');
      expect(has(f, '#testnet-payout')).toBe(true);
    });

    it('Start on Testnet node username/password omits datadir', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      selectAuth(f, 'testnet', 'Userpass');
      setInput(f, '#testnet-rpcUser', 'rpcuser');
      setInput(f, '#testnet-rpcPassword', 'rpcpass');
      setInput(f, '#testnet-payout', 'tgfcn1qqq');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        chain: 'testnet',
        threads: 4,
        gpuIds: [],
        mineTo: {
          kind: 'node',
          rpc: { host: '127.0.0.1', port: 35332, auth: { kind: 'userpass', user: 'rpcuser', password: 'rpcpass' } },
          payout: 'tgfcn1qqq',
        },
      });
    });

    it('keeps RPC auth kind across a remount', async () => {
      const miner = stubMiner();
      const first = await render(miner);
      selectAuth(first, 'testnet', 'Userpass');
      setInput(first, '#testnet-rpcUser', 'alice');
      first.destroy();
      const second = await render(miner);
      expect(queryEl<HTMLInputElement>(second, '#testnet-authUserpass').checked).toBe(true);
      expect(queryEl<HTMLInputElement>(second, '#testnet-rpcUser').value).toBe('alice');
      expect(has(second, '#testnet-datadir')).toBe(false);
    });

    it('shows DATUM Node RPC beside DATUM host and worker, without a password field', async () => {
      const f = await render(stubMiner());
      selectKind(f, 'testnet', 'Datum');
      expect(has(f, '#testnet-datumWorker')).toBe(true);
      expect(has(f, '#testnet-datumHost')).toBe(true);
      expect(has(f, '#testnet-datum-rpcHost')).toBe(true);
      expect(has(f, '#testnet-rpcHost')).toBe(false);
      expect(has(f, '#testnet-stratumPassword')).toBe(false);
      expect(queryEl<HTMLInputElement>(f, '#testnet-datumPort').value).toBe('28916');
      expect(queryEl<HTMLInputElement>(f, '#testnet-datum-rpcPort').value).toBe('35332');
      expect(queryEl(f, 'label[for="testnet-datum-rpcHost"]').textContent).toContain('RPC host');
    });

    it('Start in Testnet DATUM Prime sends node RPC plus DATUM host', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      selectKind(f, 'testnet', 'Datum');
      setInput(f, '#testnet-datumHost', '10.0.0.8');
      setInput(f, '#testnet-datum-rpcHost', '192.168.1.4');
      setInput(f, '#testnet-datumWorker', 'tgfcn1abc.cpu');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        chain: 'testnet',
        threads: 4,
        gpuIds: [],
        mineTo: {
          kind: 'datum',
          datum: {
            host: '10.0.0.8',
            port: 28916,
            worker: 'tgfcn1abc.cpu',
            rpc: cookieRpc('/tmp/x', '192.168.1.4'),
          },
        },
      });
    });

    it('keeps DATUM Node RPC distinct from Node mine-to RPC across a remount', async () => {
      const miner = stubMiner();
      const first = await render(miner);
      setInput(first, '#testnet-rpcHost', '10.0.0.1');
      selectKind(first, 'testnet', 'Datum');
      setInput(first, '#testnet-datum-rpcHost', '10.0.0.2');
      setInput(first, '#testnet-datumHost', '10.0.0.8');
      first.destroy();
      const second = await render(miner);
      expect(queryEl<HTMLInputElement>(second, '#testnet-mineToDatum').checked).toBe(true);
      expect(queryEl<HTMLInputElement>(second, '#testnet-datum-rpcHost').value).toBe('10.0.0.2');
      expect(queryEl<HTMLInputElement>(second, '#testnet-datumHost').value).toBe('10.0.0.8');
      selectKind(second, 'testnet', 'Node');
      expect(queryEl<HTMLInputElement>(second, '#testnet-rpcHost').value).toBe('10.0.0.1');
    });

    it('persists Testnet Stratum kind across a remount', async () => {
      const miner = stubMiner();
      const first = await render(miner);
      selectKind(first, 'testnet', 'Stratum');
      first.destroy();
      const second = await render(miner);
      expect(queryEl<HTMLInputElement>(second, '#testnet-mineToStratum').checked).toBe(true);
      expect(has(second, '#testnet-stratumWorker')).toBe(true);
    });

    it('Start in Testnet Stratum sends a stratum mineTo', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      selectKind(f, 'testnet', 'Stratum');
      setInput(f, '#testnet-stratumWorker', 'tgfcn1abc.cpu');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        chain: 'testnet',
        threads: 4,
        gpuIds: [],
        mineTo: {
          kind: 'stratum',
          stratum: { host: '127.0.0.1', port: 23334, worker: 'tgfcn1abc.cpu', password: 'x' },
        },
      });
    });

    it('shows a GPUs fieldset on Testnet', async () => {
      const f = await render(stubMiner());
      expect(has(f, '#testnet-gpus')).toBe(true);
      expect(queryEl(f, '#testnet-gpus').textContent).toMatch(/OpenCL or CUDA|GPUs listed yet|Off until you tick/);
    });

    it('Detect GPUs reports when the hasher addon is missing', async () => {
      const gpus = vi.fn().mockResolvedValue({ devices: [], addon: false });
      const f = await render(stubMiner({ gpus }));
      queryDe(f, '#testnet-detectGpus').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      expect(gpus).toHaveBeenCalled();
      expect(queryEl(f, '#testnet-gpus').textContent).toMatch(/No GPU hasher/);
    });

    it('GPU checkboxes use safe ids and Start sends the real CUDA id', async () => {
      const deviceId = 'cuda:0:NVIDIA GeForce RTX 3090 Ti';
      const gpus = vi.fn().mockResolvedValue({
        devices: [
          {
            id: deviceId,
            name: 'NVIDIA GeForce RTX 3090 Ti',
            vendor: 'NVIDIA',
            memoryMiB: 24563,
            backend: 'cuda',
            kind: 'discrete',
          },
        ],
        addon: true,
      });
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ gpus, start }));
      queryDe(f, '#testnet-detectGpus').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      const box = queryEl<HTMLInputElement>(f, '#testnet-gpu-cuda-0-NVIDIA-GeForce-RTX-3090-Ti');
      expect(box.type).toBe('checkbox');
      queryDe(f, '#testnet-gpu-cuda-0-NVIDIA-GeForce-RTX-3090-Ti').triggerEventHandler('change', {
        target: { checked: true },
      });
      f.detectChanges();
      selectKind(f, 'testnet', 'Stratum');
      setInput(f, '#testnet-stratumWorker', 'tgfcn1abc.cpu');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({
          gpuIds: [deviceId],
        }),
      );
    });

    it('Start on Main node RPC sends gfcn payout and dummy RPC port', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      selectNetwork(f, 'main');
      setInput(f, '#main-payout', 'gfcn1qqq');
      queryDe(f, '#main-start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        chain: 'main',
        threads: 4,
        gpuIds: [],
        mineTo: {
          kind: 'node',
          rpc: cookieRpc('/tmp/x', '127.0.0.1', 4094),
          payout: 'gfcn1qqq',
        },
      });
    });

    it('switching network while mining stops the hasher', async () => {
      const miner = stubMiner();
      const f = await render(miner);
      setInput(f, '#testnet-payout', 'tgfcn1qqq');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      expect(queryEl<HTMLButtonElement>(f, '#testnet-stop').disabled).toBe(false);
      selectNetwork(f, 'main');
      await f.whenStable();
      f.detectChanges();
      expect(miner.stop).toHaveBeenCalled();
      expect(queryEl(f, '[role="status"]').textContent).toMatch(/switched to Main/i);
      expect(queryEl<HTMLButtonElement>(f, '#main-stop').disabled).toBe(true);
    });

    it('Start on Main while Testnet is mining calls stop then start', async () => {
      const miner = stubMiner();
      const f = await render(miner);
      setInput(f, '#testnet-payout', 'tgfcn1qqq');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      selectNetwork(f, 'main');
      setInput(f, '#main-payout', 'gfcn1qqq');
      queryDe(f, '#main-start').triggerEventHandler('click');
      await f.whenStable();
      expect(miner.stop).toHaveBeenCalled();
      expect(miner.start).toHaveBeenCalledTimes(2);
      expect(miner.start).toHaveBeenLastCalledWith(expect.objectContaining({ chain: 'main' }));
    });

    it('shows a start error from the main process', async () => {
      const start = vi.fn().mockResolvedValue({ ok: false, error: 'worker is empty' });
      const f = await render(stubMiner({ start }));
      selectKind(f, 'testnet', 'Stratum');
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

    it('stacks RpcConnect host, port, and datadir in the pool pane', async () => {
      const f = await render(stubMiner());
      expect(queryEl<HTMLInputElement>(f, '#testnet-pool-rpcHost').value).toBe('127.0.0.1');
      expect(queryEl<HTMLInputElement>(f, '#testnet-pool-rpcPort').value).toBe('35332');
      expect(queryEl<HTMLInputElement>(f, '#testnet-pool-datadir').value).toBe('/tmp/x');
      expect(queryEl(f, 'label[for="testnet-pool-rpcHost"]').textContent).toContain('RPC host');
      expect(queryEl(f, 'label[for="testnet-pool-datadir"]').textContent).toContain('Node data directory');
      expect(queryEl<HTMLInputElement>(f, '#testnet-pool-authCookie').checked).toBe(true);
      expect(has(f, '#testnet-pool-rpcUser')).toBe(false);
    });

    it('keeps mining and pool visible together', async () => {
      const f = await render(stubMiner());
      expect(has(f, '#tab-main')).toBe(false);
      expect(has(f, '#tab-pool')).toBe(false);
      expect(queryEl<HTMLInputElement>(f, '#testnet-pool-stratumPort').value).toBe('23334');
      expect(queryEl<HTMLInputElement>(f, '#testnet-pool-datumPort').value).toBe('28916');
    });

    it('Start on pool sends spawn IPC without a cookie', async () => {
      const poolStart = vi.fn<(opts: PoolStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ poolStart }));
      setInput(f, '#testnet-pool-operator', 'tgfcn1abc');
      queryDe(f, '#testnet-pool-start').triggerEventHandler('click');
      await f.whenStable();
      expect(poolStart).toHaveBeenCalledWith({
        chain: 'testnet',
        rpc: cookieRpc('/tmp/x'),
        operator: 'tgfcn1abc',
        feeBps: 200,
        stratumHost: '127.0.0.1',
        stratumPort: 23334,
        datumHost: '127.0.0.1',
        datumPort: 28916,
      });
      expect(JSON.stringify(poolStart.mock.calls[0]?.[0])).not.toMatch(/__cookie__/);
    });

    it('Stop on pool calls poolStop', async () => {
      const miner = stubMiner();
      const f = await render(miner);
      setInput(f, '#testnet-pool-operator', 'tgfcn1abc');
      queryDe(f, '#testnet-pool-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      expect(queryEl<HTMLButtonElement>(f, '#testnet-pool-stop').disabled).toBe(false);
      queryDe(f, '#testnet-pool-stop').triggerEventHandler('click');
      await f.whenStable();
      expect(miner.poolStop).toHaveBeenCalled();
    });

    it('app-pool mine-to appears only while the pool is running', async () => {
      const f = await render(stubMiner());
      expect(has(f, '#testnet-mineToAppPoolStratum')).toBe(false);
      setInput(f, '#testnet-pool-operator', 'tgfcn1abc');
      queryDe(f, '#testnet-pool-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      expect(has(f, '#testnet-mineToAppPoolStratum')).toBe(true);
      expect(has(f, '#testnet-mineToAppPoolDatum')).toBe(true);
      selectKind(f, 'testnet', 'AppPoolStratum');
      expect(queryEl(f, '.frozen').textContent).toContain('127.0.0.1:23334');
      selectKind(f, 'testnet', 'AppPoolDatum');
      expect(has(f, '#testnet-appPoolDatum-rpcHost')).toBe(true);
      expect(queryEl(f, '.frozen').textContent).toContain('127.0.0.1:28916');
    });

    it('Start app-pool Stratum omits host and port', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      setInput(f, '#testnet-pool-operator', 'tgfcn1abc');
      queryDe(f, '#testnet-pool-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      selectKind(f, 'testnet', 'AppPoolStratum');
      setInput(f, '#testnet-appPoolStratumWorker', 'tgfcn1abc.cpu');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        chain: 'testnet',
        threads: 4,
        gpuIds: [],
        mineTo: { kind: 'appPoolStratum', worker: 'tgfcn1abc.cpu', password: 'x' },
      });
    });

    it('Start app-pool DATUM sends hasher Node RPC without DATUM host or port', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      setInput(f, '#testnet-pool-operator', 'tgfcn1abc');
      queryDe(f, '#testnet-pool-start').triggerEventHandler('click');
      await f.whenStable();
      f.detectChanges();
      selectKind(f, 'testnet', 'AppPoolDatum');
      setInput(f, '#testnet-appPoolDatum-rpcHost', '10.0.0.9');
      setInput(f, '#testnet-appPoolDatumWorker', 'tgfcn1abc.cpu');
      queryDe(f, '#testnet-start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        chain: 'testnet',
        threads: 4,
        gpuIds: [],
        mineTo: {
          kind: 'appPoolDatum',
          worker: 'tgfcn1abc.cpu',
          rpc: cookieRpc('/tmp/x', '10.0.0.9'),
        },
      });
    });

    it('lists TIDES coinbase outs from pool stats', async () => {
      let sendPool: ((s: PoolStats) => void) | undefined;
      const f = await render(
        stubMiner({
          onPoolStats: (cb) => {
            sendPool = cb;
            return () => undefined;
          },
        }),
      );
      sendPool?.({
        running: true,
        chain: 'testnet',
        height: 2,
        workers: 1,
        accepted: 7,
        rejected: 0,
        lastError: '',
        status: 'height 2',
        stratumHost: '127.0.0.1',
        stratumPort: 23334,
        datumHost: '127.0.0.1',
        datumPort: 28916,
        payouts: [
          { miner: 'tgfcn1operator', sats: '4999931640' },
          { miner: 'tgfcn1alice', sats: '34180' },
        ],
      });
      f.detectChanges();
      expect(queryEl(f, '#testnet-pool-tides').textContent).toContain('tgfcn1alice');
      expect(queryEl(f, '#testnet-pool-tides').textContent).toContain('0.00034180');
    });

    it('Host a pool Main warning stays not-live', async () => {
      const f = await render(stubMiner());
      selectNetwork(f, 'main');
      expect(has(f, '[data-pool-main-warning]')).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#main-pool-operator').placeholder).toContain('gfcn1');
    });
  });
});
