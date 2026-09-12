#include "gpu_pow.hpp"

#include <cstring>

namespace gpu {

bool xor_key_is_zero(const uint8_t xor_key[16])
{
    for (int i = 0; i < 16; ++i) {
        if (xor_key[i] != 0) {
            return false;
        }
    }
    return true;
}

void xor_key_mask_bytes(const uint8_t xor_key[16], uint8_t clear_bits, uint8_t mask[32])
{
    std::memset(mask, 0, 32);
    if (xor_key_is_zero(xor_key)) {
        return;
    }
    tagged_sha256("Bitcoin block hash PoW XOR mask", xor_key, 16, mask);
    unsigned clear_bytes = clear_bits / 8;
    if (clear_bytes > 32) {
        clear_bytes = 32;
    }
    std::memset(mask, 0, clear_bytes);
    if (clear_bytes < 32) {
        mask[clear_bytes] = uint8_t(mask[clear_bytes] & (0xffu >> (clear_bits % 8)));
    }
}

void asic_pow_hash(const uint8_t work[80], const uint8_t xor_key[16], uint8_t xor_clear_bits, uint8_t out[32])
{
    uint8_t hash[32];
    blake2b_32(work, 80, hash);
    uint8_t mask[32];
    xor_key_mask_bytes(xor_key, xor_clear_bits, mask);
    for (int i = 0; i < 32; ++i) {
        out[31 - i] = uint8_t(hash[i] ^ mask[i]);
    }
}

bool hash_meets_target(const uint8_t hash[32], const uint8_t target[32])
{
    for (int i = 31; i >= 0; --i) {
        if (hash[i] < target[i]) {
            return true;
        }
        if (hash[i] > target[i]) {
            return false;
        }
    }
    return true;
}

} // namespace gpu
