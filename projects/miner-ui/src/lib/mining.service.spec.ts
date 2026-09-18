import { TestBed } from '@angular/core/testing';
import { ElectronHasherHost } from './electron-hasher';
import { HASHER_HOST } from './hasher-host';
import { IDLE_STATS, MiningService } from './mining.service';
import type { MinerApi, MinerInfo, MinerStartOpts, MinerStats } from './miner-api';

const electronInfo: MinerInfo = {
  cookiePath: '/tmp/x/testnet3/.cookie',
  datadir: '/tmp/x',
  rpc: '127.0.0.1:35332',
  electron: true,
  defaultThreads: 4,
};

function stubMiner(overrides: Partial<MinerApi> = {}): MinerApi {
  let statsCb: ((s: MinerStats) => void) | undefined;
  return {
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
      return () => undefined;
    }),
    onLog: vi.fn().mockReturnValue(() => undefined),
    onToast: vi.fn().mockReturnValue(() => undefined),
    poolStart: vi.fn().mockResolvedValue({ ok: true }),
    poolStop: vi.fn().mockResolvedValue(undefined),
    poolRefresh: vi.fn().mockResolvedValue({ ok: true }),
    onPoolStats: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('MiningService', () => {
  beforeEach(() => {
    delete window.miner;
    TestBed.configureTestingModule({
      providers: [{ provide: HASHER_HOST, useClass: ElectronHasherHost }],
    });
  });

  afterEach(() => {
    delete window.miner;
    TestBed.resetTestingModule();
  });

  it('subscribes to onStats once for the process', () => {
    const miner = stubMiner();
    window.miner = miner;
    const a = TestBed.inject(MiningService);
    const b = TestBed.inject(MiningService);
    expect(a).toBe(b);
    expect(miner.onStats).toHaveBeenCalledTimes(1);
    expect(miner.onToast).toHaveBeenCalledTimes(1);
  });

  it('stops the current session before starting the other chain', async () => {
    const miner = stubMiner();
    window.miner = miner;
    const svc = TestBed.inject(MiningService);
    await svc.start({
      chain: 'testnet',
      threads: 4,
      mineTo: {
        kind: 'stratum',
        stratum: { host: '127.0.0.1', port: 23334, worker: 'tgfcn1abc.cpu', password: 'x' },
      },
    });
    expect(miner.stop).not.toHaveBeenCalled();
    await svc.start({
      chain: 'main',
      threads: 4,
      mineTo: {
        kind: 'node',
        rpc: { host: '127.0.0.1', port: 4094, auth: { kind: 'cookie', datadir: '/tmp/x' } },
        payout: 'gfcn1qqq',
      },
    });
    expect(miner.stop).toHaveBeenCalledTimes(1);
    expect(miner.start).toHaveBeenCalledTimes(2);
    expect(miner.start).toHaveBeenLastCalledWith(expect.objectContaining({ chain: 'main' }));
  });

  it('updates when the hasher mutates and re-emits the same stats object', () => {
    const miner = stubMiner();
    window.miner = miner;
    const svc = TestBed.inject(MiningService);
    const onStats = miner.onStats as ReturnType<typeof vi.fn>;
    const cb = onStats.mock.calls[0]?.[0] as ((s: MinerStats) => void) | undefined;
    expect(cb).toBeDefined();
    const shared: MinerStats = {
      ...IDLE_STATS,
      running: true,
      chain: 'testnet',
      status: 'connecting wss://pool.testnet.federationcoin.org/stratum',
    };
    cb!(shared);
    expect(svc.stats().status).toContain('connecting');
    shared.status = 'authorized tgfcn1qqq.web';
    cb!(shared);
    expect(svc.stats().status).toBe('authorized tgfcn1qqq.web');
    expect(svc.stats()).not.toBe(shared);
  });

  it('records the WebGPU scan reason from the renderer', async () => {
    const miner = stubMiner({
      gpus: vi.fn().mockResolvedValue({ devices: [], addon: false }),
    });
    window.miner = miner;
    const svc = TestBed.inject(MiningService);
    const scan = await svc.refreshGpus();
    expect(scan.addon).toBe(false);
    expect(svc.gpuScanned()).toBe(true);
    expect(svc.gpuReason()).toBe('no-api');
    expect(svc.gpuDevices()).toEqual([]);
  });
});
