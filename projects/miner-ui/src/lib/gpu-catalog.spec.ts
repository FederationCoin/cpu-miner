import {
  catalogHasWebGpu,
  groupGpuAdapters,
  liveGpuPicks,
  migrateGpuIds,
  parseGpuPicks,
  setAdapterPick,
  type NativeGpuDevice,
  type WebGpuDevice,
} from './gpu-catalog';

const cuda3090: NativeGpuDevice = {
  kind: 'cuda',
  index: 0,
  id: 'cuda:0:NVIDIA GeForce RTX 3090 Ti',
  name: 'NVIDIA GeForce RTX 3090 Ti',
  vendor: 'NVIDIA',
  memoryMiB: 24563,
  deviceKind: 'discrete',
};

const ocl3090: NativeGpuDevice = {
  kind: 'opencl',
  platform: 0,
  device: 0,
  id: 'opencl:0:0:NVIDIA GeForce RTX 3090 Ti',
  name: 'NVIDIA GeForce RTX 3090 Ti',
  vendor: 'NVIDIA',
  memoryMiB: 24563,
  deviceKind: 'discrete',
};

const web3090: WebGpuDevice = {
  kind: 'webgpu',
  adapter: 0,
  name: 'NVIDIA GeForce RTX 3090 Ti',
  vendor: 'nvidia',
};

describe('groupGpuAdapters', () => {
  it('merges CUDA, OpenCL, and WebGPU onto one adapter', () => {
    const adapters = groupGpuAdapters([cuda3090, ocl3090], [web3090]);
    expect(adapters).toHaveLength(1);
    expect(adapters[0]!.key).toBe('nvidia geforce rtx 3090 ti');
    expect(adapters[0]!.label).toBe('NVIDIA GeForce RTX 3090 Ti');
    expect(adapters[0]!.strategies.map((s) => s.kind)).toEqual(['webgpu', 'cuda', 'opencl']);
  });

  it('omits CUDA when PTX did not list it and keeps OpenCL', () => {
    const adapters = groupGpuAdapters([ocl3090], [web3090]);
    expect(adapters[0]!.strategies.map((s) => s.kind)).toEqual(['webgpu', 'opencl']);
  });

  it('web-only Detect is a single WebGPU adapter', () => {
    const adapters = groupGpuAdapters([], [web3090]);
    expect(adapters).toEqual([
      {
        key: 'nvidia geforce rtx 3090 ti',
        label: 'NVIDIA GeForce RTX 3090 Ti',
        memoryMiB: 0,
        deviceKind: 'discrete',
        strategies: [{ kind: 'webgpu', adapter: 0 }],
      },
    ]);
    expect(catalogHasWebGpu(adapters)).toBe(true);
  });

  it('disambiguates two cards with the same name', () => {
    const second: NativeGpuDevice = { ...cuda3090, index: 1, id: 'cuda:1:NVIDIA GeForce RTX 3090 Ti' };
    const adapters = groupGpuAdapters([cuda3090, second], []);
    expect(adapters.map((a) => a.key)).toEqual(['nvidia geforce rtx 3090 ti#0', 'nvidia geforce rtx 3090 ti#1']);
  });
});

describe('migrateGpuIds', () => {
  it('maps saved cuda/opencl/webgpu strings onto adapter picks', () => {
    const adapters = groupGpuAdapters([cuda3090, ocl3090], [web3090]);
    expect(migrateGpuIds(['cuda:0:NVIDIA GeForce RTX 3090 Ti'], adapters)).toEqual([
      { adapter: 'nvidia geforce rtx 3090 ti', strategy: { kind: 'cuda', index: 0 } },
    ]);
    expect(migrateGpuIds(['opencl:0:0:NVIDIA GeForce RTX 3090 Ti'], adapters)[0]!.strategy).toEqual({
      kind: 'opencl',
      platform: 0,
      device: 0,
    });
    expect(migrateGpuIds(['webgpu:0'], adapters)[0]!.strategy).toEqual({ kind: 'webgpu', adapter: 0 });
  });

  it('drops a CUDA id when that strategy is not listed', () => {
    const adapters = groupGpuAdapters([ocl3090], []);
    expect(migrateGpuIds(['cuda:0:NVIDIA GeForce RTX 3090 Ti'], adapters)).toEqual([]);
  });
});

describe('parseGpuPicks', () => {
  it('keeps well-formed picks and drops junk', () => {
    expect(
      parseGpuPicks([
        { adapter: 'nvidia geforce rtx 3090 ti', strategy: { kind: 'cuda', index: 0 } },
        { adapter: 'x' },
        null,
      ]),
    ).toEqual([{ adapter: 'nvidia geforce rtx 3090 ti', strategy: { kind: 'cuda', index: 0 } }]);
  });
});

describe('setAdapterPick', () => {
  it('Off removes the adapter; a strategy replaces it', () => {
    const adapters = groupGpuAdapters([cuda3090], []);
    const key = adapters[0]!.key;
    const on = setAdapterPick([], key, { kind: 'cuda', index: 0 });
    expect(on).toHaveLength(1);
    expect(setAdapterPick(on, key, null)).toEqual([]);
    expect(liveGpuPicks(on, adapters)).toEqual(on);
  });
});
