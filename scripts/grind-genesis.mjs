#!/usr/bin/env node
// Laptop-only: fill v2 genesis nNonce/m_nonce2 using the miner app GPU hasher
// (same GetHash as the node). Do not run from CI. CI checks compiled-in
// hashes and BLOCKINFO rows; it never searches for a block.
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const miner = join(here, '../out-electron');

const HEADLINE = '09/Sep/2026 FederationCoin: time is the unit, not the state';
const TESTNET_BITS = 0x1c03a830;
const LOCKTIME_THRESHOLD = 500000000;

function sha256d(data) {
  return createHash('sha256').update(createHash('sha256').update(data).digest()).digest();
}

function compactPush(data) {
  const n = data.length;
  if (n < 0x4c) {
    return Buffer.concat([Buffer.from([n]), data]);
  }
  throw new Error(`push ${n}`);
}

function scriptNum(n) {
  if (n === 0) {
    return Buffer.alloc(0);
  }
  const neg = n < 0;
  let abs = BigInt(neg ? -n : n);
  const bytes = [];
  while (abs > 0n) {
    bytes.push(Number(abs & 0xffn));
    abs >>= 8n;
  }
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(neg ? 0x80 : 0);
  } else if (neg) {
    bytes[bytes.length - 1] |= 0x80;
  }
  return Buffer.from(bytes);
}

function pushInt(n) {
  if (n === -1 || (n >= 1 && n <= 16)) {
    return Buffer.from([n + 0x50]);
  }
  if (n === 0) {
    return Buffer.from([0]);
  }
  return compactPush(scriptNum(n));
}

function compactSize(n) {
  if (n < 0xfd) {
    return Buffer.from([n]);
  }
  throw new Error(`compact ${n}`);
}

function coinbaseScriptSig() {
  const hl = Buffer.from(HEADLINE, 'utf8');
  return Buffer.concat([
    pushInt(486604799),
    compactPush(scriptNum(4)),
    compactPush(hl),
  ]);
}

function genesisTx() {
  const scriptSig = coinbaseScriptSig();
  const spk = Buffer.concat([Buffer.from([0x21]), Buffer.alloc(33), Buffer.from([0xac])]);
  const parts = [];
  const ver = Buffer.alloc(4);
  ver.writeUInt32LE(1, 0);
  parts.push(ver);
  parts.push(compactSize(1));
  parts.push(Buffer.alloc(32));
  const nout = Buffer.alloc(4);
  nout.writeUInt32LE(0xffffffff, 0);
  parts.push(nout);
  parts.push(compactSize(scriptSig.length));
  parts.push(scriptSig);
  const seq = Buffer.alloc(4);
  seq.writeUInt32LE(0xffffffff, 0);
  parts.push(seq);
  parts.push(compactSize(1));
  const val = Buffer.alloc(8);
  val.writeBigUInt64LE(5000000000n, 0);
  parts.push(val);
  parts.push(compactSize(spk.length));
  parts.push(spk);
  const lock = Buffer.alloc(4);
  lock.writeUInt32LE(0, 0);
  parts.push(lock);
  return Buffer.concat(parts);
}

function displayHex(internal) {
  return Buffer.from(internal).reverse().toString('hex');
}

const {
  emptyHeader,
  asicPreimage,
  asicPowHash,
  headerHash,
  targetFromCompact,
  hashMeetsTarget,
  serializeHeader,
} = await import(pathToFileURL(join(miner, 'pow.js')).href);
const { toHex } = await import(pathToFileURL(join(miner, 'bytes.js')).href);
const { listGpus, startGpuGrind, stopGpu } = await import(pathToFileURL(join(miner, 'gpu.js')).href);

function oldV1Merkle(timestamp) {
  const ts = Buffer.from(timestamp, 'utf8');
  const scriptSig = Buffer.concat([pushInt(486604799), compactPush(scriptNum(4)), compactPush(ts)]);
  const spk = Buffer.concat([Buffer.from([0x21]), Buffer.alloc(33), Buffer.from([0xac])]);
  const ver = Buffer.alloc(4);
  ver.writeUInt32LE(1, 0);
  const nout = Buffer.alloc(4);
  nout.writeUInt32LE(0xffffffff, 0);
  const seq = Buffer.alloc(4);
  seq.writeUInt32LE(0xffffffff, 0);
  const val = Buffer.alloc(8);
  val.writeBigUInt64LE(5000000000n, 0);
  const lock = Buffer.alloc(4);
  const tx = Buffer.concat([
    ver,
    compactSize(1),
    Buffer.alloc(32),
    nout,
    compactSize(scriptSig.length),
    scriptSig,
    seq,
    compactSize(1),
    val,
    compactSize(spk.length),
    spk,
    lock,
  ]);
  return displayHex(sha256d(tx));
}

const expectOld = '657a6ec8479f3691139773b02986e6941fb1a7e951e30b8e3676d062e78b0e9f';
const gotOld = oldV1Merkle('09/Sep/2026 FederationCoin testnet3: time is the unit, not the state');
if (gotOld !== expectOld) {
  throw new Error(`coinbase serializer mismatch got ${gotOld}`);
}

function makeHeader(merkleInternal, nTime, nBits) {
  const h = emptyHeader();
  h.nVersion = 1;
  h.hashMerkleRoot = new Uint8Array(merkleInternal);
  h.nTime = nTime >>> 0;
  h.nBits = nBits >>> 0;
  h.txcount = 1;
  h.height = 0;
  return h;
}

function grindCpu(h, target) {
  const work = asicPreimage(h);
  const xorKey = h.xorKey;
  const xorClear = h.xorKeyMaskClearBits;
  for (let nonce2 = 0; nonce2 < 0x10000; nonce2++) {
    work[36] = nonce2 & 0xff;
    work[37] = (nonce2 >>> 8) & 0xff;
    work[38] = (nonce2 >>> 16) & 0xff;
    work[39] = (nonce2 >>> 24) & 0xff;
    for (let nonce = 0; nonce <= 0xffffffff; nonce++) {
      work[32] = nonce & 0xff;
      work[33] = (nonce >>> 8) & 0xff;
      work[34] = (nonce >>> 16) & 0xff;
      work[35] = (nonce >>> 24) & 0xff;
      const hash = asicPowHash(work, xorKey, xorClear);
      if (hashMeetsTarget(hash, target)) {
        h.nNonce = nonce >>> 0;
        h.nonce2 = nonce2 >>> 0;
        return;
      }
    }
  }
  throw new Error('cpu nonce space');
}

function grindGpu(h, target) {
  const devices = listGpus();
  const gpu = devices.find((d) => d.backend === 'cuda');
  if (!gpu) {
    throw new Error('no CUDA GPU');
  }
  const work = asicPreimage(h);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let hashes = 0n;
    let lastLog = 0;
    const timer = setTimeout(() => {
      stopGpu();
      reject(new Error('gpu grind timeout'));
    }, 3600_000);
    const ok = startGpuGrind({
      deviceId: gpu.id,
      work,
      target,
      xorKey: new Uint8Array(16),
      xorClear: 0,
      extraNonce2: new Uint8Array(8),
      gen: 1,
      onProgress: (n) => {
        hashes += BigInt(n);
        const now = Date.now();
        if (now - lastLog < 5000) {
          return;
        }
        lastLog = now;
        const dt = (now - t0) / 1000;
        const hs = dt > 0 ? Number(hashes) / dt : 0;
        process.stderr.write(` gpu ${(hs / 1e9).toFixed(2)} GH/s hashes=${hashes}\n`);
      },
      onFound: (msg) => {
        clearTimeout(timer);
        h.nNonce = msg.nonce >>> 0;
        h.nonce2 = msg.nonce2 >>> 0;
        stopGpu();
        resolve();
      },
      onLog: (m) => {
        process.stderr.write(` ${m}\n`);
        if (m.startsWith('gpu: ')) {
          clearTimeout(timer);
          stopGpu();
          reject(new Error(m));
        }
      },
    });
    if (!ok) {
      clearTimeout(timer);
      reject(new Error('startGpuGrind failed'));
    }
  });
}

const nets = [
  {
    name: 'main',
    timestamp: 'UNLAUNCHED FederationCoin placeholder; not main',
    nTime: LOCKTIME_THRESHOLD,
    nBits: 0x1e00ffff,
    gpu: true,
  },
  {
    name: 'testnet3',
    timestamp: '09/Sep/2026 FederationCoin testnet3: time is the unit, not the state',
    nTime: Math.floor(Date.now() / 1000),
    nBits: TESTNET_BITS,
    gpu: true,
  },
  {
    name: 'testnet4',
    timestamp: '09/Sep/2026 FederationCoin testnet4: time is the unit, not the state',
    nTime: Math.floor(Date.now() / 1000) + 1,
    nBits: TESTNET_BITS,
    gpu: true,
  },
  {
    name: 'signet',
    timestamp: '09/Sep/2026 FederationCoin signet: time is the unit, not the state',
    nTime: Math.floor(Date.now() / 1000) + 2,
    nBits: 0x1e0377ae,
    gpu: true,
  },
  {
    name: 'regtest',
    timestamp: '09/Sep/2026 FederationCoin regtest: time is the unit, not the state',
    nTime: Math.floor(Date.now() / 1000) + 3,
    nBits: 0x207fffff,
    gpu: true,
  },
];

for (const net of nets) {
  const merkleInternal = sha256d(genesisTx());
  const merkleDisp = displayHex(merkleInternal);
  const h = makeHeader(merkleInternal, net.nTime, net.nBits);
  const target = targetFromCompact(net.nBits);
  if (!target) {
    throw new Error(`bad bits ${net.name}`);
  }
  process.stderr.write(`${net.name} merkle=${merkleDisp} grinding ${net.gpu ? 'gpu' : 'cpu'}\n`);
  if (net.gpu) {
    await grindGpu(h, target);
  } else {
    grindCpu(h, target);
  }
  const hash = headerHash(h);
  if (!hashMeetsTarget(hash, target)) {
    throw new Error(`${net.name} hash missed target`);
  }
  const headerHex = toHex(serializeHeader(h));
  process.stdout.write(
    JSON.stringify({
      name: net.name,
      nTime: h.nTime,
      nNonce: h.nNonce,
      nNonce2: h.nonce2,
      nBits: net.nBits,
      merkle: merkleDisp,
      hash: displayHex(hash),
      header: headerHex,
    }) + '\n',
  );
}
