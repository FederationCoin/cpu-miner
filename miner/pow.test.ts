import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeAddress, addressToScript, payoutScript } from './bech32.js';
import { BLAKE2B_HEADLINE, coinbaseScriptSig } from './coinbase.js';
import { toHex, u128FromHexReversed, u256FromHex, u256ToHex } from './bytes.js';
import { blake2b32, sha256 } from './hash.js';
import { asicPreimage, deserializeHeader, emptyHeader, headerHash, serializeHeader, type HeaderV2 } from './pow.js';

const testdata = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../testdata/block_header_v2.json'), 'utf8'),
) as {
  headers: {
    name: string;
    fields: {
      nVersion: number;
      hashPrevBlock: string;
      hashMerkleRoot: string;
      nTime: number;
      nBits: number;
      nNonce: number;
      m_nonce2: number;
      m_nonce3: number;
      m_extranonce: string;
      m_time_offset: number;
      m_txcount: number;
      m_flags: number;
      m_xor_key_mask_clear_bits: number;
      m_xor_key: string;
      m_height: number;
      m_mm_rhs: string;
    };
    serialized: string;
    block_hash: string;
    asic_input: string;
  }[];
};

function headerFromFields(f: (typeof testdata.headers)[0]['fields']): HeaderV2 {
  const h = emptyHeader();
  h.nVersion = f.nVersion;
  h.hashPrevBlock = u256FromHex(f.hashPrevBlock);
  h.hashMerkleRoot = u256FromHex(f.hashMerkleRoot);
  h.nTime = f.nTime;
  h.nBits = f.nBits;
  h.nNonce = f.nNonce;
  h.nonce2 = f.m_nonce2;
  h.nonce3 = f.m_nonce3;
  h.extranonce = u128FromHexReversed(f.m_extranonce);
  h.timeOffset = f.m_time_offset;
  h.txcount = f.m_txcount;
  h.flags = f.m_flags;
  h.xorKeyMaskClearBits = f.m_xor_key_mask_clear_bits;
  h.xorKey = u128FromHexReversed(f.m_xor_key);
  h.height = f.m_height;
  h.mmRhs = u256FromHex(f.m_mm_rhs);
  return h;
}

describe('header-v2 vectors', () => {
  it('has five committed headers', () => {
    expect(testdata.headers.length).toBe(5);
  });

  for (const vec of testdata.headers) {
    it(vec.name, () => {
      const h = headerFromFields(vec.fields);
      const ser = serializeHeader(h);
      expect(toHex(ser)).toBe(vec.serialized);
      expect(u256ToHex(headerHash(h))).toBe(vec.block_hash);
      expect(toHex(asicPreimage(h))).toBe(vec.asic_input);
      const decoded = deserializeHeader(ser);
      expect(decoded).not.toBeNull();
      expect(u256ToHex(headerHash(decoded!))).toBe(vec.block_hash);
    });
  }
});

describe('coinbase scriptSig', () => {
  it('height 1 includes the Blake2b headline', () => {
    const sig = coinbaseScriptSig(1);
    const want = '51003b' + toHex(new TextEncoder().encode(BLAKE2B_HEADLINE));
    expect(toHex(sig)).toBe(want);
  });

  it('height 17 is 011100', () => {
    expect(toHex(coinbaseScriptSig(17))).toBe('011100');
  });
});

describe('sha256 / blake2b self-checks', () => {
  it('sha256 empty and abc', () => {
    expect(toHex(sha256(new Uint8Array()))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('blake2b-256 empty', () => {
    expect(toHex(blake2b32(new Uint8Array()))).toBe(
      '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8',
    );
  });
});

describe('payout address', () => {
  it('accepts a tfcn1 taproot address on testnet', () => {
    const program = new Uint8Array(32).fill(0x11);
    const addr = encodeAddress('tfcn', 1, program);
    expect(addr).toMatch(/^tfcn1p/);
    const script = payoutScript(addr!, 'testnet');
    expect(script[0]).toBe(0x51);
    expect(script[1]).toBe(32);
  });

  it('refuses fcn1 on testnet', () => {
    const program = new Uint8Array(32).fill(0x11);
    const addr = encodeAddress('fcn', 1, program);
    expect(() => payoutScript(addr!, 'testnet')).toThrow(/tfcn1, not fcn1/);
  });

  it('accepts a fcn1 taproot address on main', () => {
    const program = new Uint8Array(32).fill(0x11);
    const addr = encodeAddress('fcn', 1, program);
    expect(addr).toMatch(/^fcn1p/);
    const script = payoutScript(addr!, 'main');
    expect(script[0]).toBe(0x51);
    expect(script[1]).toBe(32);
  });

  it('refuses tfcn1 on main', () => {
    const program = new Uint8Array(32).fill(0x11);
    const addr = encodeAddress('tfcn', 1, program);
    expect(() => payoutScript(addr!, 'main')).toThrow(/fcn1, not tfcn1/);
  });

  it('accepts witness v0 tfcn and fcn', () => {
    const program = new Uint8Array(20).fill(0x11);
    const tfcn = encodeAddress('tfcn', 0, program);
    const fcn = encodeAddress('fcn', 0, program);
    const t = addressToScript(tfcn!);
    const m = addressToScript(fcn!);
    expect(t?.hrp).toBe('tfcn');
    expect(t?.script[0]).toBe(0x00);
    expect(t?.script[1]).toBe(20);
    expect(m?.hrp).toBe('fcn');
    expect(m?.script[0]).toBe(0x00);
  });

  it('rejects Bitcoin HRPs', () => {
    expect(addressToScript('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBeNull();
    expect(addressToScript('tb1qawkzyj2l5yck5jq4wyhkc4837x088580y9uyk8')).toBeNull();
    expect(() => payoutScript('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'testnet')).toThrow(/tfcn1/);
  });
});
