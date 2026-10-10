import type { MinerApi, WebGpuIpcJob } from './miner-api';
import { webgpuGrind } from './webgpu';

export function bindDesktopWebGpu(api: MinerApi): () => void {
  if (!api.onWebGpuJob) {
    return () => undefined;
  }
  let activeGen = -1;
  let stop = false;
  const offJob = api.onWebGpuJob((job) => {
    activeGen = job.gen;
    stop = false;
    void grindDesktopWebGpu(job, () => stop || job.gen !== activeGen, api);
  });
  const offStop = api.onWebGpuStop
    ? api.onWebGpuStop((msg) => {
        if (msg.gen === activeGen) {
          stop = true;
        }
      })
    : () => undefined;
  return () => {
    stop = true;
    offJob();
    offStop();
  };
}

async function grindDesktopWebGpu(
  job: WebGpuIpcJob,
  stopped: () => boolean,
  api: MinerApi,
): Promise<void> {
  const work = Uint8Array.from(job.work);
  const target = Uint8Array.from(job.target);
  const mask = job.mask.length === 32 ? Uint8Array.from(job.mask) : new Uint8Array(32);
  let nonce = Math.floor(Math.random() * 0xffffffff) >>> 0;
  await api.webGpuLog?.(`gpu: hashing on webgpu:${job.label}`);
  while (!stopped()) {
    const r = await webgpuGrind(work, target, nonce >>> 0, 0, 4096, 16, mask);
    if (stopped()) {
      return;
    }
    await api.webGpuProgress?.({ gen: job.gen, hashes: r.hashes });
    if (r.nonce !== undefined) {
      await api.webGpuFound?.({
        gen: job.gen,
        nonce: r.nonce,
        nonce2: r.nonce2 ?? 0,
        hashes: r.hashes,
        extraNonce2: job.extraNonce2,
      });
      return;
    }
    nonce = (nonce + r.hashes) >>> 0;
  }
}
