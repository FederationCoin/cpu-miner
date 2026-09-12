// DATUM profile-0 hot path: blake2b-256 of 80-byte work, XOR mask, byte-reverse.
// Not SHA256d. Not Sia-blob blake2b. Host supplies the 32-byte XOR mask.

#define rotr64(x, r) (((x) >> (r)) | ((x) << (64 - (r))))

__constant ulong blake2b_IV[8] = {
    0x6a09e667f3bcc908UL, 0xbb67ae8584caa73bUL, 0x3c6ef372fe94f82bUL, 0xa54ff53a5f1d36f1UL,
    0x510e527fade682d1UL, 0x9b05688c2b3e6c1fUL, 0x1f83d9abfb41bd6bUL, 0x5be0cd19137e2179UL};

__constant uchar blake2b_sigma[12][16] = {
    {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
    {14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3},
    {11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4},
    {7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8},
    {9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13},
    {2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9},
    {12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11},
    {13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10},
    {6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5},
    {10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0},
    {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
    {14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3},
};

ulong load64_priv(const uchar* p)
{
    return (ulong)p[0] | ((ulong)p[1] << 8) | ((ulong)p[2] << 16) | ((ulong)p[3] << 24)
        | ((ulong)p[4] << 32) | ((ulong)p[5] << 40) | ((ulong)p[6] << 48) | ((ulong)p[7] << 56);
}

void store64_priv(uchar* p, ulong x)
{
    p[0] = (uchar)x;
    p[1] = (uchar)(x >> 8);
    p[2] = (uchar)(x >> 16);
    p[3] = (uchar)(x >> 24);
    p[4] = (uchar)(x >> 32);
    p[5] = (uchar)(x >> 40);
    p[6] = (uchar)(x >> 48);
    p[7] = (uchar)(x >> 56);
}

void blake2b_compress_priv(ulong h[8], const uchar block[128], ulong t0, ulong t1, ulong f0, ulong f1)
{
    ulong m[16];
    ulong v[16];
    for (int i = 0; i < 16; ++i) {
        m[i] = load64_priv(block + i * 8);
    }
    for (int i = 0; i < 8; ++i) {
        v[i] = h[i];
    }
    v[8] = blake2b_IV[0];
    v[9] = blake2b_IV[1];
    v[10] = blake2b_IV[2];
    v[11] = blake2b_IV[3];
    v[12] = blake2b_IV[4] ^ t0;
    v[13] = blake2b_IV[5] ^ t1;
    v[14] = blake2b_IV[6] ^ f0;
    v[15] = blake2b_IV[7] ^ f1;

#define G(r, i, a, b, c, d)                                 \
    do {                                                    \
        a = a + b + m[blake2b_sigma[r][2 * i + 0]];         \
        d = rotr64((d ^ a), 32);                            \
        c = c + d;                                          \
        b = rotr64((b ^ c), 24);                            \
        a = a + b + m[blake2b_sigma[r][2 * i + 1]];         \
        d = rotr64((d ^ a), 16);                            \
        c = c + d;                                          \
        b = rotr64((b ^ c), 63);                            \
    } while (0)

#define ROUND(r)                           \
    do {                                   \
        G(r, 0, v[0], v[4], v[8], v[12]);  \
        G(r, 1, v[1], v[5], v[9], v[13]);  \
        G(r, 2, v[2], v[6], v[10], v[14]); \
        G(r, 3, v[3], v[7], v[11], v[15]); \
        G(r, 4, v[0], v[5], v[10], v[15]); \
        G(r, 5, v[1], v[6], v[11], v[12]); \
        G(r, 6, v[2], v[7], v[8], v[13]);  \
        G(r, 7, v[3], v[4], v[9], v[14]);  \
    } while (0)

    ROUND(0);
    ROUND(1);
    ROUND(2);
    ROUND(3);
    ROUND(4);
    ROUND(5);
    ROUND(6);
    ROUND(7);
    ROUND(8);
    ROUND(9);
    ROUND(10);
    ROUND(11);

#undef G
#undef ROUND

    for (int i = 0; i < 8; ++i) {
        h[i] = h[i] ^ v[i] ^ v[i + 8];
    }
}

void blake2b32_80(const uchar work[80], uchar out[32])
{
    ulong h[8];
    for (int i = 0; i < 8; ++i) {
        h[i] = blake2b_IV[i];
    }
    uchar P[64];
    for (int i = 0; i < 64; ++i) {
        P[i] = 0;
    }
    P[0] = 32;
    P[2] = 1;
    P[3] = 1;
    for (int i = 0; i < 8; ++i) {
        h[i] ^= load64_priv(P + i * 8);
    }
    uchar block[128];
    for (int i = 0; i < 128; ++i) {
        block[i] = 0;
    }
    for (int i = 0; i < 80; ++i) {
        block[i] = work[i];
    }
    blake2b_compress_priv(h, block, 80, 0, (ulong)(-1), 0);
    uchar buf[64];
    for (int i = 0; i < 8; ++i) {
        store64_priv(buf + i * 8, h[i]);
    }
    for (int i = 0; i < 32; ++i) {
        out[i] = buf[i];
    }
}

void asic_final(const uchar work[80], const uchar mask[32], uchar out[32])
{
    uchar hash[32];
    blake2b32_80(work, hash);
    for (int i = 0; i < 32; ++i) {
        out[31 - i] = (uchar)(hash[i] ^ mask[i]);
    }
}

int meets_target(const uchar hash[32], const uchar target[32])
{
    for (int i = 31; i >= 0; --i) {
        if (hash[i] < target[i]) {
            return 1;
        }
        if (hash[i] > target[i]) {
            return 0;
        }
    }
    return 1;
}

__kernel void asic_pow_hash_one(__global const uchar* work80, __global const uchar* mask32, __global uchar* out32)
{
    uchar work[80];
    uchar mask[32];
    uchar out[32];
    for (int i = 0; i < 80; ++i) {
        work[i] = work80[i];
    }
    for (int i = 0; i < 32; ++i) {
        mask[i] = mask32[i];
    }
    asic_final(work, mask, out);
    for (int i = 0; i < 32; ++i) {
        out32[i] = out[i];
    }
}

__kernel void asic_pow_grind(__global const uchar* work80, __global const uchar* mask32, __global const uchar* target32,
    uint nonce_lo, uint nonce_hi, __global uint* found)
{
    uint gid = get_global_id(0);
    ulong full = (ulong)nonce_lo + (ulong)gid;
    uint n = (uint)full;
    uint n2 = nonce_hi + (uint)(full >> 32);

    uchar work[80];
    uchar mask[32];
    uchar target[32];
    uchar out[32];
    for (int i = 0; i < 80; ++i) {
        work[i] = work80[i];
    }
    for (int i = 0; i < 32; ++i) {
        mask[i] = mask32[i];
        target[i] = target32[i];
    }
    work[32] = (uchar)n;
    work[33] = (uchar)(n >> 8);
    work[34] = (uchar)(n >> 16);
    work[35] = (uchar)(n >> 24);
    work[36] = (uchar)n2;
    work[37] = (uchar)(n2 >> 8);
    work[38] = (uchar)(n2 >> 16);
    work[39] = (uchar)(n2 >> 24);
    asic_final(work, mask, out);
    if (meets_target(out, target)) {
        if (atomic_cmpxchg(found, 0, 1) == 0) {
            found[1] = n;
            found[2] = n2;
        }
    }
}
