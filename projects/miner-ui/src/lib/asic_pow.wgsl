// DATUM profile-0: blake2b-256 of 80-byte work, XOR mask, byte-reverse.
// u32 pairs stand in for u64. Matches native/gpu-hasher/kernel/asic_pow.cl.

const IV0 = vec2<u32>(0xf3bcc908u, 0x6a09e667u);
const IV1 = vec2<u32>(0x84caa73bu, 0xbb67ae85u);
const IV2 = vec2<u32>(0xfe94f82bu, 0x3c6ef372u);
const IV3 = vec2<u32>(0x5f1d36f1u, 0xa54ff53au);
const IV4 = vec2<u32>(0xade682d1u, 0x510e527fu);
const IV5 = vec2<u32>(0x2b3e6c1fu, 0x9b05688cu);
const IV6 = vec2<u32>(0xfb41bd6bu, 0x1f83d9abu);
const IV7 = vec2<u32>(0x137e2179u, 0x5be0cd19u);

const SIGMA = array<array<u32, 16>, 12>(
    array<u32, 16>(0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u, 8u, 9u, 10u, 11u, 12u, 13u, 14u, 15u),
    array<u32, 16>(14u, 10u, 4u, 8u, 9u, 15u, 13u, 6u, 1u, 12u, 0u, 2u, 11u, 7u, 5u, 3u),
    array<u32, 16>(11u, 8u, 12u, 0u, 5u, 2u, 15u, 13u, 10u, 14u, 3u, 6u, 7u, 1u, 9u, 4u),
    array<u32, 16>(7u, 9u, 3u, 1u, 13u, 12u, 11u, 14u, 2u, 6u, 5u, 10u, 4u, 0u, 15u, 8u),
    array<u32, 16>(9u, 0u, 5u, 7u, 2u, 4u, 10u, 15u, 14u, 1u, 11u, 12u, 6u, 8u, 3u, 13u),
    array<u32, 16>(2u, 12u, 6u, 10u, 0u, 11u, 8u, 3u, 4u, 13u, 7u, 5u, 15u, 14u, 1u, 9u),
    array<u32, 16>(12u, 5u, 1u, 15u, 14u, 13u, 4u, 10u, 0u, 7u, 6u, 3u, 9u, 2u, 8u, 11u),
    array<u32, 16>(13u, 11u, 7u, 14u, 12u, 1u, 3u, 9u, 5u, 0u, 15u, 4u, 8u, 6u, 2u, 10u),
    array<u32, 16>(6u, 15u, 14u, 9u, 11u, 3u, 0u, 8u, 12u, 2u, 13u, 7u, 1u, 4u, 10u, 5u),
    array<u32, 16>(10u, 2u, 8u, 4u, 7u, 6u, 1u, 5u, 15u, 11u, 9u, 14u, 3u, 12u, 13u, 0u),
    array<u32, 16>(0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u, 8u, 9u, 10u, 11u, 12u, 13u, 14u, 15u),
    array<u32, 16>(14u, 10u, 4u, 8u, 9u, 15u, 13u, 6u, 1u, 12u, 0u, 2u, 11u, 7u, 5u, 3u),
);

fn add64(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
    let lo = a.x + b.x;
    let carry = select(0u, 1u, lo < a.x);
    return vec2<u32>(lo, a.y + b.y + carry);
}

fn rotr64(x: vec2<u32>, n: u32) -> vec2<u32> {
    if (n == 32u) {
        return vec2<u32>(x.y, x.x);
    }
    if (n < 32u) {
        return vec2<u32>((x.x >> n) | (x.y << (32u - n)), (x.y >> n) | (x.x << (32u - n)));
    }
    let k = n - 32u;
    return vec2<u32>((x.y >> k) | (x.x << (32u - k)), (x.x >> k) | (x.y << (32u - k)));
}

var<private> vv: array<vec2<u32>, 16>;
var<private> mm: array<vec2<u32>, 16>;

fn mix_g(r: u32, i: u32, a: u32, b: u32, c: u32, d: u32) {
    vv[a] = add64(add64(vv[a], vv[b]), mm[SIGMA[r][2u * i]]);
    vv[d] = rotr64(vv[d] ^ vv[a], 32u);
    vv[c] = add64(vv[c], vv[d]);
    vv[b] = rotr64(vv[b] ^ vv[c], 24u);
    vv[a] = add64(add64(vv[a], vv[b]), mm[SIGMA[r][2u * i + 1u]]);
    vv[d] = rotr64(vv[d] ^ vv[a], 16u);
    vv[c] = add64(vv[c], vv[d]);
    vv[b] = rotr64(vv[b] ^ vv[c], 63u);
}

fn round_r(r: u32) {
    mix_g(r, 0u, 0u, 4u, 8u, 12u);
    mix_g(r, 1u, 1u, 5u, 9u, 13u);
    mix_g(r, 2u, 2u, 6u, 10u, 14u);
    mix_g(r, 3u, 3u, 7u, 11u, 15u);
    mix_g(r, 4u, 0u, 5u, 10u, 15u);
    mix_g(r, 5u, 1u, 6u, 11u, 12u);
    mix_g(r, 6u, 2u, 7u, 8u, 13u);
    mix_g(r, 7u, 3u, 4u, 9u, 14u);
}

fn blake2b32_80(work: array<u32, 20>) -> array<u32, 8> {
    var h: array<vec2<u32>, 8>;
    h[0] = IV0;
    h[1] = IV1;
    h[2] = IV2;
    h[3] = IV3;
    h[4] = IV4;
    h[5] = IV5;
    h[6] = IV6;
    h[7] = IV7;
    // param: digest 32, fanout 1, depth 1 in the first 8 bytes
    h[0] = h[0] ^ vec2<u32>(0x01010020u, 0u);
    var block: array<u32, 32>;
    for (var i = 0u; i < 20u; i++) {
        block[i] = work[i];
    }
    for (var i = 0u; i < 16u; i++) {
        mm[i] = vec2<u32>(block[i * 2u], block[i * 2u + 1u]);
    }
    for (var i = 0u; i < 8u; i++) {
        vv[i] = h[i];
    }
    vv[8] = IV0;
    vv[9] = IV1;
    vv[10] = IV2;
    vv[11] = IV3;
    vv[12] = IV4 ^ vec2<u32>(80u, 0u);
    vv[13] = IV5;
    vv[14] = IV6 ^ vec2<u32>(0xffffffffu, 0xffffffffu);
    vv[15] = IV7;
    for (var r = 0u; r < 12u; r++) {
        round_r(r);
    }
    for (var i = 0u; i < 8u; i++) {
        h[i] = h[i] ^ vv[i] ^ vv[i + 8u];
    }
    var out: array<u32, 8>;
    out[0] = h[0].x;
    out[1] = h[0].y;
    out[2] = h[1].x;
    out[3] = h[1].y;
    out[4] = h[2].x;
    out[5] = h[2].y;
    out[6] = h[3].x;
    out[7] = h[3].y;
    return out;
}

fn byte_at(words: array<u32, 8>, i: u32) -> u32 {
    let w = words[i / 4u];
    let s = (i % 4u) * 8u;
    return (w >> s) & 0xffu;
}

fn asic_final(work: array<u32, 20>, mask: array<u32, 8>) -> array<u32, 8> {
    let hash = blake2b32_80(work);
    var outb: array<u32, 32>;
    for (var i = 0u; i < 32u; i++) {
        outb[31u - i] = byte_at(hash, i) ^ byte_at(mask, i);
    }
    var out: array<u32, 8>;
    for (var i = 0u; i < 8u; i++) {
        let o = i * 4u;
        out[i] = outb[o] | (outb[o + 1u] << 8u) | (outb[o + 2u] << 16u) | (outb[o + 3u] << 24u);
    }
    return out;
}

fn meets_target(hash: array<u32, 8>, target: array<u32, 8>) -> bool {
    var i: i32 = 31;
    loop {
        if (i < 0) {
            return true;
        }
        let hb = byte_at(hash, u32(i));
        let tb = byte_at(target, u32(i));
        if (hb < tb) {
            return true;
        }
        if (hb > tb) {
            return false;
        }
        i = i - 1;
    }
}

struct GrindParams {
    nonce_lo: u32,
    nonce_hi: u32,
    iter: u32,
}

@group(0) @binding(0) var<storage, read> work80: array<u32>;
@group(0) @binding(1) var<storage, read> mask32: array<u32>;
@group(0) @binding(2) var<storage, read> target32: array<u32>;
@group(0) @binding(3) var<uniform> params: GrindParams;
@group(0) @binding(4) var<storage, read_write> found: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> hash_out: array<u32>;

@compute @workgroup_size(64)
fn asic_pow_hash_one(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x != 0u) {
        return;
    }
    var work: array<u32, 20>;
    var mask: array<u32, 8>;
    for (var i = 0u; i < 20u; i++) {
        work[i] = work80[i];
    }
    for (var i = 0u; i < 8u; i++) {
        mask[i] = mask32[i];
    }
    let out = asic_final(work, mask);
    for (var i = 0u; i < 8u; i++) {
        hash_out[i] = out[i];
    }
}

@compute @workgroup_size(64)
fn asic_pow_grind(@builtin(global_invocation_id) gid: vec3<u32>) {
    let start = params.nonce_lo + gid.x * params.iter;
    var work: array<u32, 20>;
    var mask: array<u32, 8>;
    var target: array<u32, 8>;
    for (var i = 0u; i < 20u; i++) {
        work[i] = work80[i];
    }
    for (var i = 0u; i < 8u; i++) {
        mask[i] = mask32[i];
        target[i] = target32[i];
    }
    for (var k = 0u; k < params.iter; k++) {
        if ((k & 63u) == 0u && atomicLoad(&found[0]) != 0u) {
            return;
        }
        let n = start + k;
        work[8] = n;
        work[9] = params.nonce_hi;
        let out = asic_final(work, mask);
        if (meets_target(out, target)) {
            if (atomicExchange(&found[0], 1u) == 0u) {
                atomicStore(&found[1], n);
                atomicStore(&found[2], params.nonce_hi);
            }
            return;
        }
    }
}
