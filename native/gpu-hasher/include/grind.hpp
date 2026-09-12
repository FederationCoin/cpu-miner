#pragma once

#include "opencl_runtime.hpp"

#include <cstdint>
#include <functional>
#include <string>

namespace gpu {

struct GpuJob {
    uint8_t work[80]{};
    uint8_t target[32]{};
    uint8_t xor_key[16]{};
    uint8_t xor_clear = 0;
    uint8_t extra_nonce2[8]{};
    GpuDeviceInfo device;
    uint32_t gen = 0;
};

using FoundFn = std::function<void(uint32_t nonce, uint32_t nonce2, uint64_t hashes)>;
using ProgressFn = std::function<void(uint64_t hashes)>;
using LogFn = std::function<void(const std::string& msg)>;
using DoneFn = std::function<void()>;

void stop_all_grinds();
bool start_device_grind(GpuJob job, FoundFn found, ProgressFn progress, LogFn log, DoneFn done);

} // namespace gpu
