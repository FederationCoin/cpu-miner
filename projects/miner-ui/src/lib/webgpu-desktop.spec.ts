import { bindDesktopWebGpu } from './webgpu-desktop';
import type { MinerApi } from './miner-api';

describe('bindDesktopWebGpu', () => {
  it('is a no-op when the preload has no WebGPU job channel', () => {
    const api = {} as MinerApi;
    const unbind = bindDesktopWebGpu(api);
    expect(typeof unbind).toBe('function');
    unbind();
  });
});
