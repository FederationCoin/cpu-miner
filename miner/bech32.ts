/** BIP173 bech32 / BIP350 bech32m decode. Payouts are witness v0 only. */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function charsetRev(c: string): number {
  const ch = c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) - 65 + 97) : c;
  return CHARSET.indexOf(ch);
}

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

function createChecksum(hrp: string, data: number[], spec: number): number[] {
  const values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
  const mod = (polymod(values) ^ spec) >>> 0;
  const ret: number[] = [];
  for (let p = 0; p < 6; p++) {
    ret.push((mod >>> (5 * (5 - p))) & 31);
  }
  return ret;
}

function convertBitsTo5(program: Uint8Array): number[] | null {
  const out = convertBits([...program], 8, 5, true);
  if (!out) {
    return null;
  }
  return [...out];
}

/** Encode witness v0 (bech32) or v1+ (bech32m). */
export function encodeAddress(hrp: string, witver: number, program: Uint8Array): string | null {
  if (witver < 0 || witver > 16) {
    return null;
  }
  const prog5 = convertBitsTo5(program);
  if (!prog5) {
    return null;
  }
  const spec = witver === 0 ? 1 : 0x2bc830a3;
  const data = [witver, ...prog5];
  const checksum = createChecksum(hrp, data, spec);
  let s = hrp + '1';
  for (const v of data.concat(checksum)) {
    s += CHARSET[v];
  }
  return s;
}

export function bech32Decode(addr: string): { hrp: string; witver: number; program: Uint8Array } | null {
  if (addr.length < 8 || addr.length > 90) {
    return null;
  }
  let lower = false;
  let upper = false;
  let s = '';
  for (const c of addr) {
    if (c >= 'a' && c <= 'z') {
      lower = true;
      s += c;
    } else if (c >= 'A' && c <= 'Z') {
      upper = true;
      s += String.fromCharCode(c.charCodeAt(0) - 65 + 97);
    } else {
      s += c;
    }
  }
  if (lower && upper) {
    return null;
  }
  const pos = s.lastIndexOf('1');
  if (pos <= 0 || pos + 7 > s.length) {
    return null;
  }
  const hrp = s.slice(0, pos);
  const data: number[] = [];
  for (let i = pos + 1; i < s.length; i++) {
    const v = charsetRev(s[i]!);
    if (v < 0) {
      return null;
    }
    data.push(v);
  }
  if (data.length < 6) {
    return null;
  }
  const values = hrpExpand(hrp).concat(data);
  const pm = polymod(values);
  if (pm !== 1 && pm !== 0x2bc830a3) {
    return null;
  }
  const witver = data[0]!;
  if (witver > 16) {
    return null;
  }
  const program = convertBits(data.slice(1, data.length - 6), 5, 8, false);
  if (!program || program.length < 2 || program.length > 40) {
    return null;
  }
  if (witver === 0 && program.length !== 20 && program.length !== 32) {
    return null;
  }
  if (witver === 0 && pm !== 1) {
    return null;
  }
  if (witver !== 0 && pm !== 0x2bc830a3) {
    return null;
  }
  return { hrp, witver, program };
}

/** Witness scriptPubKey codec. Accepts tgfcn / gfcn HRPs; payoutScript allows v0 only. */
export function addressToScript(addr: string): { hrp: string; script: Uint8Array } | null {
  const d = bech32Decode(addr);
  if (!d) {
    return null;
  }
  if (d.hrp !== 'tgfcn' && d.hrp !== 'gfcn') {
    return null;
  }
  const script = new Uint8Array(2 + d.program.length);
  if (d.witver === 0) {
    script[0] = 0x00;
  } else if (d.witver <= 16) {
    script[0] = d.witver + 0x50;
  } else {
    return null;
  }
  script[1] = d.program.length;
  script.set(d.program, 2);
  return { hrp: d.hrp, script };
}

export function payoutScript(addr: string, chain: 'main' | 'testnet'): Uint8Array {
  const decoded = addressToScript(addr.trim());
  const want = chain === 'main' ? 'gfcn' : 'tgfcn';
  const label = chain === 'main' ? 'gfcn1' : 'tgfcn1';
  const other = chain === 'main' ? 'tgfcn1' : 'gfcn1';
  if (!decoded) {
    throw new Error(`payout must be a ${label} bech32 address`);
  }
  if (decoded.hrp !== want) {
    throw new Error(`payout must be ${label}, not ${other}`);
  }
  if (decoded.script[0] !== 0x00) {
    throw new Error(
      `payout must be witness v0 bech32 (P2WPKH/P2WSH). Witness v1 / bech32m (Taproot) is not supported`,
    );
  }
  return decoded.script;
}
