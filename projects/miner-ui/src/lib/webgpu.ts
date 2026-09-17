import { ASIC_POW_WGSL } from './asic-pow.shader';
import type { GpuDevice, GpuScanReason } from './miner-api';

const ADAPTER_REQUEST = { powerPreference: 'high-performance' as const };

export type WebGpuScan = {
  devices: GpuDevice[];
  reason: GpuScanReason;
  detail?: string;
};

export async function webgpuAvailable(): Promise<boolean> {
  return !!(globalThis.navigator && 'gpu' in navigator);
}

async function requestWebGpuAdapter(): Promise<GPUAdapter | null> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) {
    return null;
  }
  return gpu.requestAdapter(ADAPTER_REQUEST);
}

export async function diagnoseWebGpu(): Promise<WebGpuScan> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) {
    return { devices: [], reason: 'no-api' };
  }
  try {
    const adapter = await gpu.requestAdapter(ADAPTER_REQUEST);
    if (!adapter) {
      return { devices: [], reason: 'no-adapter' };
    }
    const info = adapter.info;
    return {
      reason: 'ok',
      devices: [
        {
          id: 'webgpu:0',
          name: info?.device || info?.description || 'WebGPU adapter',
          vendor: info?.vendor || 'webgpu',
          memoryMiB: 0,
          backend: 'webgpu',
          kind: 'discrete',
        },
      ],
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { devices: [], reason: 'error', detail };
  }
}

export async function scanWebGpu(): Promise<GpuDevice[]> {
  const scan = await diagnoseWebGpu();
  return scan.devices;
}

export type WebGpuHashResult = { hash: Uint8Array } | { error: string };

export async function webgpuAsicPowHash(work: Uint8Array, mask: Uint8Array = new Uint8Array(32)): Promise<WebGpuHashResult> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) {
    return { error: 'no WebGPU' };
  }
  if (work.length !== 80) {
    return { error: 'work must be 80 bytes' };
  }
  const adapter = await requestWebGpuAdapter();
  if (!adapter) {
    return { error: 'no adapter' };
  }
  const device = await adapter.requestDevice();
  const module = device.createShaderModule({ code: ASIC_POW_WGSL });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'asic_pow_hash_one' },
  });
  const workBuf = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const maskBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const targetBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const uniformBuf = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const foundBuf = device.createBuffer({
    size: 12,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const hashBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const readBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(workBuf, 0, work);
  const mask32 = new Uint8Array(32);
  mask32.set(mask.subarray(0, 32));
  device.queue.writeBuffer(maskBuf, 0, mask32);
  device.queue.writeBuffer(targetBuf, 0, new Uint8Array(32));
  device.queue.writeBuffer(uniformBuf, 0, new Uint32Array([0, 0, 1, 0]));
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: workBuf } },
      { binding: 1, resource: { buffer: maskBuf } },
      { binding: 2, resource: { buffer: targetBuf } },
      { binding: 3, resource: { buffer: uniformBuf } },
      { binding: 4, resource: { buffer: foundBuf } },
      { binding: 5, resource: { buffer: hashBuf } },
    ],
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.dispatchWorkgroups(1);
  pass.end();
  enc.copyBufferToBuffer(hashBuf, 0, readBuf, 0, 32);
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const hash = new Uint8Array(readBuf.getMappedRange().slice(0, 32));
  readBuf.unmap();
  device.destroy();
  return { hash };
}

export async function webgpuGrind(
  work: Uint8Array,
  target: Uint8Array,
  nonceLo: number,
  nonceHi: number,
  iter: number,
  groups: number,
): Promise<{ nonce?: number; nonce2?: number; hashes: number }> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) {
    return { hashes: 0 };
  }
  const adapter = await requestWebGpuAdapter();
  if (!adapter) {
    return { hashes: 0 };
  }
  const device = await adapter.requestDevice();
  const module = device.createShaderModule({ code: ASIC_POW_WGSL });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'asic_pow_grind' },
  });
  const workBuf = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const maskBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const targetBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const uniformBuf = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const foundBuf = device.createBuffer({
    size: 12,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const hashBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE,
  });
  const readBuf = device.createBuffer({
    size: 12,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(workBuf, 0, work);
  device.queue.writeBuffer(maskBuf, 0, new Uint8Array(32));
  device.queue.writeBuffer(targetBuf, 0, target);
  device.queue.writeBuffer(uniformBuf, 0, new Uint32Array([nonceLo >>> 0, nonceHi >>> 0, iter >>> 0, 0]));
  device.queue.writeBuffer(foundBuf, 0, new Uint32Array([0, 0, 0]));
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: workBuf } },
      { binding: 1, resource: { buffer: maskBuf } },
      { binding: 2, resource: { buffer: targetBuf } },
      { binding: 3, resource: { buffer: uniformBuf } },
      { binding: 4, resource: { buffer: foundBuf } },
      { binding: 5, resource: { buffer: hashBuf } },
    ],
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.dispatchWorkgroups(Math.max(1, groups));
  pass.end();
  enc.copyBufferToBuffer(foundBuf, 0, readBuf, 0, 12);
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const view = new Uint32Array(readBuf.getMappedRange().slice(0));
  const flag = view[0]!;
  const nonce = view[1]!;
  const nonce2 = view[2]!;
  readBuf.unmap();
  device.destroy();
  const hashes = Math.max(1, groups) * iter;
  if (flag) {
    return { nonce, nonce2, hashes };
  }
  return { hashes };
}
