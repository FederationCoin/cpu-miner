import { TestBed } from '@angular/core/testing';
import { IDLE_STATS, MiningService } from './mining.service';
import type { MinerApi, MinerInfo, MinerStartOpts, MinerStats } from '../miner-api';

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
    ...overrides,
  };
}

describe('MiningService', () => {
  beforeEach(() => {
    delete window.miner;
    TestBed.configureTestingModule({});
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
      mode: 'stratum',
      threads: 4,
      host: '127.0.0.1',
      port: 23334,
      worker: 'tfcn1abc.cpu',
      password: 'x',
    });
    expect(miner.stop).not.toHaveBeenCalled();
    await svc.start({
      chain: 'main',
      mode: 'rpc',
      threads: 4,
      host: '127.0.0.1',
      port: 4094,
      payout: 'fcn1qqq',
      datadir: '/tmp/x',
    });
    expect(miner.stop).toHaveBeenCalledTimes(1);
    expect(miner.start).toHaveBeenCalledTimes(2);
    expect(miner.start).toHaveBeenLastCalledWith(expect.objectContaining({ chain: 'main' }));
  });
});
