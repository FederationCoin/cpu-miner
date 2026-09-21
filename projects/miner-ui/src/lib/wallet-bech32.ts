const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) {
      if ((b >>> i) & 1) {
        chk = (chk ^ GEN[i]!) >>> 0;
      }
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const r: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    r.push(hrp.charCodeAt(i) >>> 5);
  }
  r.push(0);
  for (let i = 0; i < hrp.length; i++) {
    r.push(hrp.charCodeAt(i) & 31);
  }
  return r;
}

function convertBits(input: number[], from: number, to: number, pad: boolean): Uint8Array | null {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << to) - 1;
  const maxAcc = (1 << (from + to - 1)) - 1;
  const out: number[] = [];
  for (const v of input) {
    if (v < 0 || v >> from) {
      return null;
    }
    acc = ((acc << from) | v) & maxAcc;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) {
      out.push((acc << (to - bits)) & maxv);
    }
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null;
  }
  return Uint8Array.from(out);
}

export function encodeAddress(hrp: string, witver: number, program: Uint8Array): string | null {
  if (witver < 0 || witver > 16) {
    return null;
  }
  const out = convertBits([...program], 8, 5, true);
  if (!out) {
    return null;
  }
  const spec = witver === 0 ? 1 : 0x2bc830a3;
  const data = [witver, ...out];
  const values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
  const mod = (polymod(values) ^ spec) >>> 0;
  const checksum: number[] = [];
  for (let p = 0; p < 6; p++) {
    checksum.push((mod >>> (5 * (5 - p))) & 31);
  }
  let s = hrp + '1';
  for (const v of data.concat(checksum)) {
    s += CHARSET[v];
  }
  return s;
}
