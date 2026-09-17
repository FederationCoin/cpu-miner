import { diagnoseWebGpu, scanWebGpu } from './webgpu';

type GpuStub = {
  requestAdapter: (opts?: { powerPreference?: string }) => Promise<{ info?: { device?: string; vendor?: string } } | null>;
};

function setGpu(gpu: GpuStub | undefined): void {
  if (gpu) {
    Object.defineProperty(globalThis.navigator, 'gpu', { configurable: true, value: gpu });
  } else {
    Object.defineProperty(globalThis.navigator, 'gpu', { configurable: true, value: undefined });
  }
}

describe('diagnoseWebGpu', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');

  afterEach(() => {
    if (previous) {
      Object.defineProperty(globalThis.navigator, 'gpu', previous);
    } else {
      delete (globalThis.navigator as { gpu?: unknown }).gpu;
    }
  });

  it('reports no-api when navigator.gpu is missing', async () => {
    setGpu(undefined);
    const scan = await diagnoseWebGpu();
    expect(scan).toEqual({ devices: [], reason: 'no-api' });
    expect(await scanWebGpu()).toEqual([]);
  });

  it('reports no-adapter when requestAdapter returns null', async () => {
    const requestAdapter = vi.fn().mockResolvedValue(null);
    setGpu({ requestAdapter });
    const scan = await diagnoseWebGpu();
    expect(scan.reason).toBe('no-adapter');
    expect(scan.devices).toEqual([]);
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
  });

  it('reports error when requestAdapter throws', async () => {
    setGpu({
      requestAdapter: vi.fn().mockRejectedValue(new Error('blocklisted')),
    });
    const scan = await diagnoseWebGpu();
    expect(scan.reason).toBe('error');
    expect(scan.detail).toBe('blocklisted');
    expect(scan.devices).toEqual([]);
  });

  it('lists one synthetic adapter when requestAdapter succeeds', async () => {
    setGpu({
      requestAdapter: vi.fn().mockResolvedValue({
        info: { device: 'Test GPU', vendor: 'test' },
      }),
    });
    const scan = await diagnoseWebGpu();
    expect(scan.reason).toBe('ok');
    expect(scan.devices).toEqual([
      {
        id: 'webgpu:0',
        name: 'Test GPU',
        vendor: 'test',
        memoryMiB: 0,
        backend: 'webgpu',
        kind: 'discrete',
      },
    ]);
  });
});
