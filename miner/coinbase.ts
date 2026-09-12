import { parseHex, writeLe32, writeLe64 } from './bytes.js';
import { sha256d } from './hash.js';
import { HEADER_V2_SIZE, type HeaderV2, serializeHeader } from './pow.js';

export const BLAKE2B_HEADLINE = '09/Sep/2026 FederationCoin: time is the unit, not the state';
export const BLAKE2B_HEIGHT = 1;

export function writeCompactSize(out: number[], n: number | bigint): void {
  const v = typeof n === 'bigint' ? n : BigInt(n);
  if (v < 0xfdn) {
    out.push(Number(v));
  } else if (v <= 0xffffn) {
    out.push(0xfd, Number(v & 0xffn), Number((v >> 8n) & 0xffn));
  } else if (v <= 0xffffffffn) {
    const buf = new Uint8Array(4);
    writeLe32(buf, 0, Number(v));
    out.push(0xfe, ...buf);
  } else {
    const buf = new Uint8Array(8);
    writeLe64(buf, 0, v);
    out.push(0xff, ...buf);
  }
}

export function scriptPushBytes(out: number[], p: Uint8Array): void {
  const n = p.length;
  if (n < 0x4c) {
    out.push(n);
  } else if (n <= 0xff) {
    out.push(0x4c, n);
  } else if (n <= 0xffff) {
    out.push(0x4d, n & 0xff, (n >>> 8) & 0xff);
  } else {
    const buf = new Uint8Array(4);
    writeLe32(buf, 0, n);
    out.push(0x4e, ...buf);
  }
  for (let i = 0; i < p.length; i++) {
    out.push(p[i]!);
  }
}

export function scriptPushInt(out: number[], n: number): void {
  if (n === -1 || (n >= 1 && n <= 16)) {
    out.push(n + 0x50);
    return;
  }
  if (n === 0) {
    out.push(0x00);
    return;
  }
  const neg = n < 0;
  let absv = BigInt(neg ? -n : n);
  const v: number[] = [];
  while (absv !== 0n) {
    v.push(Number(absv & 0xffn));
    absv >>= 8n;
  }
  if ((v[v.length - 1]! & 0x80) !== 0) {
    v.push(neg ? 0x80 : 0x00);
  } else if (neg) {
    v[v.length - 1] = v[v.length - 1]! | 0x80;
  }
  scriptPushBytes(out, Uint8Array.from(v));
}

export function coinbaseScriptSig(height: number): Uint8Array {
  const s: number[] = [];
  scriptPushInt(s, height);
  s.push(0x00);
  if (height === BLAKE2B_HEIGHT) {
    scriptPushBytes(s, new TextEncoder().encode(BLAKE2B_HEADLINE));
  }
  return Uint8Array.from(s);
}

function writeTxBase(
  out: number[],
  scriptSig: Uint8Array,
  value: bigint,
  payout: Uint8Array,
  commitment: Uint8Array,
  withWitness: boolean,
): void {
  const b4 = new Uint8Array(4);
  writeLe32(b4, 0, 2);
  out.push(...b4);
  if (withWitness) {
    out.push(0x00, 0x01);
  }
  writeCompactSize(out, 1);
  for (let i = 0; i < 32; i++) {
    out.push(0);
  }
  out.push(0xff, 0xff, 0xff, 0xff);
  writeCompactSize(out, scriptSig.length);
  out.push(...scriptSig);
  out.push(0xff, 0xff, 0xff, 0xff);

  const nout = 1 + (commitment.length === 0 ? 0 : 1);
  writeCompactSize(out, nout);
  const val = new Uint8Array(8);
  writeLe64(val, 0, value);
  out.push(...val);
  writeCompactSize(out, payout.length);
  out.push(...payout);
  if (commitment.length !== 0) {
    writeLe64(val, 0, 0n);
    out.push(...val);
    writeCompactSize(out, commitment.length);
    out.push(...commitment);
  }
  if (withWitness) {
    writeCompactSize(out, 1);
    writeCompactSize(out, 32);
    for (let i = 0; i < 32; i++) {
      out.push(0);
    }
  }
  writeLe32(b4, 0, 0);
  out.push(...b4);
}

export function serializeCoinbase(
  height: number,
  value: bigint,
  payoutScript: Uint8Array,
  witnessCommitmentScript: Uint8Array,
  withWitness: boolean,
): Uint8Array {
  const tx: number[] = [];
  writeTxBase(tx, coinbaseScriptSig(height), value, payoutScript, witnessCommitmentScript, withWitness);
  return Uint8Array.from(tx);
}

export function txidFromNoWitness(txNoWitness: Uint8Array): Uint8Array {
  return sha256d(txNoWitness);
}

export type GbtTx = {
  dataHex: string;
  txid: Uint8Array;
};

export function parseGbtTransactions(gbt: {
  transactions?: { data?: string; txid?: string }[];
}): GbtTx[] {
  const txs: GbtTx[] = [];
  for (const t of gbt.transactions ?? []) {
    if (!t.data || !t.txid) {
      throw new Error('gbt tx missing data/txid');
    }
    txs.push({ dataHex: t.data, txid: u256FromHexLocal(t.txid) });
  }
  return txs;
}

function u256FromHexLocal(hex: string): Uint8Array {
  const raw = parseHex(hex);
  if (raw.length !== 32) {
    throw new Error('txid hex');
  }
  const v = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    v[i] = raw[31 - i]!;
  }
  return v;
}

export function serializeBlock(h: HeaderV2, coinbaseWithWitness: Uint8Array, txs: GbtTx[]): Uint8Array {
  const header = serializeHeader(h);
  const rest: number[] = [];
  writeCompactSize(rest, 1 + txs.length);
  const parts = [header, Uint8Array.from(rest), coinbaseWithWitness];
  const txRaw: Uint8Array[] = [];
  for (const tx of txs) {
    txRaw.push(parseHex(tx.dataHex));
  }
  let n = 0;
  for (const p of [...parts, ...txRaw]) {
    n += p.length;
  }
  const block = new Uint8Array(n);
  let o = 0;
  for (const p of [...parts, ...txRaw]) {
    block.set(p, o);
    o += p.length;
  }
  if (header.length !== HEADER_V2_SIZE) {
    throw new Error('header size');
  }
  return block;
}
