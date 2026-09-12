import { parseHex, toHex, u256FromHex, writeLe32 } from './bytes.js';
import { parseGbtTransactions, serializeCoinbase, txidFromNoWitness, type GbtTx } from './coinbase.js';
import {
  cloneHeader,
  completeVersion,
  datumCoinb1,
  emptyHeader,
  mergeMiningCommitment,
  merkleRoot,
  prevHiddenFromPrev,
  type HeaderV2,
} from './pow.js';

export const PROFILE0_FLAGS = 0;

export type GbtResult = {
  previousblockhash: string;
  bits: string;
  height: number;
  version: number;
  curtime: number;
  coinbasevalue: number;
  default_witness_commitment: string;
  longpollid?: string;
  transactions?: { data?: string; txid?: string }[];
};

export type Job = {
  hdr: HeaderV2;
  coinb1: Uint8Array;
  prevHidden: Uint8Array;
  ntime8: Uint8Array;
  coinbaseWit: Uint8Array;
  txs: GbtTx[];
  prevGbt: string;
};

export function buildJobFromGbt(gbt: GbtResult, payout: Uint8Array): Job {
  if (!gbt.previousblockhash || !gbt.bits || !gbt.default_witness_commitment) {
    throw new Error('gbt missing fields');
  }
  const witScript = parseHex(gbt.default_witness_commitment);
  const txs = parseGbtTransactions(gbt);
  const height = gbt.height | 0;
  const cbv = BigInt(gbt.coinbasevalue);
  const cbNoWit = serializeCoinbase(height, cbv, payout, witScript, false);
  const cbWit = serializeCoinbase(height, cbv, payout, witScript, true);
  const cbTxid = txidFromNoWitness(cbNoWit);
  const leaves = [cbTxid, ...txs.map((t) => t.txid)];
  const merkle = merkleRoot(leaves);

  const h = emptyHeader();
  h.nVersion = (gbt.version >>> 0) & ~0x80000000;
  h.hashPrevBlock = u256FromHex(gbt.previousblockhash);
  h.hashMerkleRoot = merkle;
  h.nTime = gbt.curtime >>> 0;
  h.nBits = Number.parseInt(gbt.bits, 16) >>> 0;
  h.txcount = (1 + txs.length) & 0xffff;
  h.flags = PROFILE0_FLAGS;
  h.height = height;

  const commitment = mergeMiningCommitment(h);
  const coinb1 = datumCoinb1(commitment);
  const prevHidden = prevHiddenFromPrev(h.hashPrevBlock);
  const ntime8 = new Uint8Array(8);
  writeLe32(ntime8, 4, h.nTime);

  return {
    hdr: h,
    coinb1,
    prevHidden,
    ntime8,
    coinbaseWit: cbWit,
    txs,
    prevGbt: gbt.previousblockhash,
  };
}

export function fillFromSubmit(job: Job, en12: Uint8Array, ntime8: Uint8Array, nonce8: Uint8Array): HeaderV2 {
  const hdr = cloneHeader(job.hdr);
  hdr.nNonce = readLe32Local(nonce8, 0);
  hdr.nonce2 = readLe32Local(nonce8, 4);
  hdr.timeOffset = readLe32Local(ntime8, 0);
  hdr.nonce3 = readLe32Local(ntime8, 4);
  hdr.extranonce.fill(0);
  hdr.extranonce.set(en12, 4);
  return hdr;
}

function readLe32Local(p: Uint8Array, o: number): number {
  return (p[o]! | (p[o + 1]! << 8) | (p[o + 2]! << 16) | (p[o + 3]! << 24)) >>> 0;
}

export function jobKey(gbt: GbtResult): string {
  return `${gbt.previousblockhash}|${gbt.longpollid ?? ''}`;
}

export function completeVersionHex(h: HeaderV2): string {
  return (completeVersion(h) >>> 0).toString(16).padStart(8, '0');
}

export function debugJobHex(job: Job): { coinb1: string; prevHidden: string; ntime: string } {
  return {
    coinb1: toHex(job.coinb1),
    prevHidden: toHex(job.prevHidden),
    ntime: toHex(job.ntime8),
  };
}
