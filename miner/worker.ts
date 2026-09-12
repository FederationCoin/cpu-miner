import { parentPort, workerData } from 'node:worker_threads';
import { asicPowHash, hashMeetsTarget } from './pow.js';
import { writeLe32 } from './bytes.js';

export type WorkerInit = {
  work: Uint8Array;
  target: Uint8Array;
  xorKey: Uint8Array;
  xorClear: number;
  start: number;
  stride: number;
  gen: number;
  extraNonce2: Uint8Array;
};

export type WorkerMsg =
  | { type: 'progress'; hashes: number; gen: number }
  | {
      type: 'found';
      nonce: number;
      nonce2: number;
      ntime8: Uint8Array;
      extraNonce2: Uint8Array;
      hashes: number;
      gen: number;
    };

const init = workerData as WorkerInit;
const work = new Uint8Array(init.work);
const target = new Uint8Array(init.target);
const xorKey = new Uint8Array(init.xorKey);
const { xorClear, start, stride, gen } = init;

const BATCH = 4096;
let n = start >>> 0;
let n2 = 0;
let hashes = 0;

if (!parentPort) {
  throw new Error('worker has no parentPort');
}

while (true) {
  writeLe32(work, 32, n);
  writeLe32(work, 36, n2);
  const h = asicPowHash(work, xorKey, xorClear);
  hashes++;
  if (hashMeetsTarget(h, target)) {
    parentPort.postMessage({
      type: 'found',
      nonce: n,
      nonce2: n2,
      ntime8: work.slice(40, 48),
      extraNonce2: init.extraNonce2,
      hashes,
      gen,
    } satisfies WorkerMsg);
    break;
  }
  const next = (n + stride) >>> 0;
  if (next < n) {
    n2 = (n2 + 1) >>> 0;
  }
  n = next;
  if (hashes === BATCH) {
    parentPort.postMessage({ type: 'progress', hashes, gen } satisfies WorkerMsg);
    hashes = 0;
  }
}
