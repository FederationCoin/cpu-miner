#pragma once

#include <cstddef>
#include <cstdint>

namespace gpu {

int blake2b_32(const uint8_t* in, size_t inlen, uint8_t out[32]);
void sha256(const uint8_t* data, size_t len, uint8_t out[32]);
void tagged_sha256(const char* tag, const uint8_t* msg, size_t n, uint8_t out[32]);

void xor_key_mask_bytes(const uint8_t xor_key[16], uint8_t clear_bits, uint8_t mask[32]);
void asic_pow_hash(const uint8_t work[80], const uint8_t xor_key[16], uint8_t xor_clear_bits, uint8_t out[32]);
bool hash_meets_target(const uint8_t hash[32], const uint8_t target[32]);

bool xor_key_is_zero(const uint8_t xor_key[16]);

} // namespace gpu
