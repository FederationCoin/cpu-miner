import { DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { App } from './app';
import type { MinerApi, MinerInfo, MinerStartOpts } from '../miner-api';

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
  return {
    start: vi.fn().mockResolvedValue({ ok: true }),
    stop: vi.fn().mockResolvedValue(undefined),
    pickDatadir: vi.fn().mockResolvedValue(null),
    logHistory: vi.fn().mockResolvedValue([]),
    info: vi.fn().mockResolvedValue(electronInfo),
    onStats: vi.fn().mockReturnValue(() => undefined),
    onLog: vi.fn().mockReturnValue(() => undefined),
    onToast: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
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

function selectMode(fixture: ComponentFixture<App>, mode: 'rpc' | 'stratum'): void {
  queryDe(fixture, mode === 'stratum' ? '#modeStratum' : '#modeRpc').triggerEventHandler('change');
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

    it('defaults to Node RPC fields and disables mining', async () => {
      const f = await render();
      expect(queryEl<HTMLInputElement>(f, '#modeRpc').checked).toBe(true);
      expect(has(f, '#payout')).toBe(true);
      expect(has(f, '#datadir')).toBe(true);
      expect(has(f, '#password')).toBe(false);
      expect(has(f, '#wslMode')).toBe(false);
      expect(has(f, '.warn')).toBe(true);
      expect(queryEl<HTMLButtonElement>(f, '#start').disabled).toBe(true);
      expect(queryEl<HTMLButtonElement>(f, '#stop').disabled).toBe(true);
    });
  });

  describe('with Electron', () => {
    it('hides the ng-serve warning and enables Start', async () => {
      const f = await render(stubMiner());
      expect(has(f, '.warn')).toBe(false);
      expect(queryEl<HTMLButtonElement>(f, '#start').disabled).toBe(false);
      expect(queryEl<HTMLButtonElement>(f, '#stop').disabled).toBe(true);
    });

    it('shows worker and password after switching to Stratum', async () => {
      const f = await render(stubMiner());
      selectMode(f, 'stratum');
      expect(has(f, '#worker')).toBe(true);
      expect(queryEl<HTMLInputElement>(f, '#password').type).toBe('password');
      expect(has(f, '#payout')).toBe(false);
      expect(has(f, '#datadir')).toBe(false);
      expect(has(f, '#wslMode')).toBe(false);
      expect(queryEl<HTMLInputElement>(f, '#port').value).toBe('23334');
    });

    it('persists Stratum mode across a remount', async () => {
      const miner = stubMiner();
      const first = await render(miner);
      selectMode(first, 'stratum');
      first.destroy();
      const second = await render(miner);
      expect(queryEl<HTMLInputElement>(second, '#modeStratum').checked).toBe(true);
      expect(has(second, '#worker')).toBe(true);
    });

    it('Start in Stratum mode sends only stratum fields', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      selectMode(f, 'stratum');
      setInput(f, '#worker', 'tfcn1abc.cpu');
      queryDe(f, '#start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        mode: 'stratum',
        threads: 4,
        host: '127.0.0.1',
        port: 23334,
        worker: 'tfcn1abc.cpu',
        password: 'x',
      });
    });

    it('Start in Node RPC mode sends payout and datadir only', async () => {
      const start = vi.fn<(opts: MinerStartOpts) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
      const f = await render(stubMiner({ start }));
      setInput(f, '#payout', 'tfcn1qqq');
      queryDe(f, '#start').triggerEventHandler('click');
      await f.whenStable();
      expect(start).toHaveBeenCalledWith({
        mode: 'rpc',
        threads: 4,
        host: '127.0.0.1',
        port: 35332,
        payout: 'tfcn1qqq',
        datadir: '/tmp/x',
      });
    });

    it('shows a start error from the main process', async () => {
      const start = vi.fn().mockResolvedValue({ ok: false, error: 'worker is empty' });
      const f = await render(stubMiner({ start }));
      selectMode(f, 'stratum');
      queryDe(f, '#start').triggerEventHandler('click');
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
  });
});
