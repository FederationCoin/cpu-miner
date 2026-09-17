import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asicPowHash, blake2b32, parseHex, toHex } from './asic-pow';
import { ASIC_POW_WGSL } from './asic-pow.shader';

const here = dirname(fileURLToPath(import.meta.url));
const testdata = JSON.parse(
  readFileSync(join(here, '../../../../testdata/block_header_v2.json'), 'utf8'),
) as { headers: { name: string; asic_input: string }[] };

function reverse32(hash: Uint8Array): Uint8Array {
  const want = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    want[31 - i] = hash[i]!;
  }
  return want;
}

describe('asicPowHash', () => {
  it('matches blake2b-256 of 80 zero bytes then byte-reverse (zero XOR mask)', () => {
    const work = new Uint8Array(80);
    expect(toHex(asicPowHash(work))).toBe(toHex(reverse32(blake2b32(work))));
  });

  it('hashes committed 80-byte asic_input rows without searching nonces', () => {
    const rows = testdata.headers.filter((vec) => parseHex(vec.asic_input).length === 80);
    expect(rows.length).toBeGreaterThan(0);
    for (const vec of rows) {
      const work = parseHex(vec.asic_input);
      expect(toHex(asicPowHash(work)), vec.name).toBe(toHex(reverse32(blake2b32(work))));
    }
  });

  it('WGSL source is the sibling shader and carries Blake2b IV words', () => {
    const disk = readFileSync(join(here, 'asic_pow.wgsl'), 'utf8');
    expect(ASIC_POW_WGSL).toBe(disk);
    expect(ASIC_POW_WGSL).toContain('0xf3bcc908u');
    expect(ASIC_POW_WGSL).toContain('asic_pow_grind');
    expect(ASIC_POW_WGSL).toContain('asic_pow_hash_one');
  });
});
