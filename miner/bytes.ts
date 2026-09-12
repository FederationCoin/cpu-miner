/** Little-endian helpers and hex. Internal u256/u128 are byte-reversed vs display hex. */

const HEX = '0123456789abcdef';

export function parseHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('odd hex');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const a = hexNibble(hex[i * 2]!);
    const b = hexNibble(hex[i * 2 + 1]!);
    if (a < 0 || b < 0) {
      throw new Error('bad hex');
    }
    out[i] = (a << 4) | b;
  }
  return out;
}

function hexNibble(c: string): number {
  if (c >= '0' && c <= '9') {
    return c.charCodeAt(0) - 48;
  }
  if (c >= 'a' && c <= 'f') {
    return c.charCodeAt(0) - 87;
  }
  if (c >= 'A' && c <= 'F') {
    return c.charCodeAt(0) - 55;
  }
  return -1;
}

export function toHex(p: Uint8Array): string {
  let s = '';
  for (let i = 0; i < p.length; i++) {
    const b = p[i]!;
    s += HEX[b >> 4];
    s += HEX[b & 0xf];
  }
  return s;
}

export function writeLe16(p: Uint8Array, o: number, v: number): void {
  p[o] = v & 0xff;
  p[o + 1] = (v >>> 8) & 0xff;
}

export function writeLe32(p: Uint8Array, o: number, v: number): void {
  p[o] = v & 0xff;
  p[o + 1] = (v >>> 8) & 0xff;
  p[o + 2] = (v >>> 16) & 0xff;
  p[o + 3] = (v >>> 24) & 0xff;
}

export function writeLe64(p: Uint8Array, o: number, v: bigint): void {
  const lo = Number(v & 0xffffffffn);
  const hi = Number((v >> 32n) & 0xffffffffn);
  writeLe32(p, o, lo);
  writeLe32(p, o + 4, hi);
}

export function readLe16(p: Uint8Array, o: number): number {
  return p[o]! | (p[o + 1]! << 8);
}

export function readLe32(p: Uint8Array, o: number): number {
  return (p[o]! | (p[o + 1]! << 8) | (p[o + 2]! << 16) | (p[o + 3]! << 24)) >>> 0;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) {
    n += p.length;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function copyBytes(v: Uint8Array): Uint8Array {
  return new Uint8Array(v);
}

export function reverseCopy(v: Uint8Array): Uint8Array {
  const o = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    o[i] = v[v.length - 1 - i]!;
  }
  return o;
}

/** Display hex → internal 32-byte (byte-reversed). */
export function u256FromHex(hex: string): Uint8Array {
  const raw = parseHex(hex);
  if (raw.length !== 32) {
    throw new Error('u256 hex');
  }
  return reverseCopy(raw);
}

export function u256ToHex(v: Uint8Array): string {
  return toHex(reverseCopy(v));
}

export function u128FromHexReversed(hex: string): Uint8Array {
  const raw = parseHex(hex);
  if (raw.length !== 16) {
    throw new Error('u128 hex');
  }
  return reverseCopy(raw);
}

export function isAllZero(v: Uint8Array): boolean {
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== 0) {
      return false;
    }
  }
  return true;
}
