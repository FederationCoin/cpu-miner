#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace gpu {

struct GpuDeviceInfo {
    std::string id;
    std::string name;
    std::string vendor;
    uint64_t memory_mib = 0;
    std::string kind; // "discrete" | "integrated"
    int platform_index = -1;
    int device_index = -1;
};

bool opencl_available();
std::vector<GpuDeviceInfo> list_opencl_devices();

struct OpenClFound {
    uint32_t nonce = 0;
    uint32_t nonce2 = 0;
    bool hit = false;
};

// One batch. nonce_lo/hi are the starting nNonce/nonce2. Returns first hit in the batch.
bool opencl_hash_batch(const GpuDeviceInfo& dev, const uint8_t work[80], const uint8_t xor_key[16],
    uint8_t xor_clear, const uint8_t target[32], uint32_t nonce_lo, uint32_t nonce_hi, uint32_t batch,
    OpenClFound* out, std::string* err);

// Single hash on the device (FEDERATIONCOIN_GPU_TEST).
bool opencl_hash_one(const GpuDeviceInfo& dev, const uint8_t work[80], const uint8_t xor_key[16],
    uint8_t xor_clear, uint8_t out[32], std::string* err);

} // namespace gpu
