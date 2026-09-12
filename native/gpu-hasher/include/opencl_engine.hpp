#pragma once

#include "opencl_runtime.hpp"

#include <memory>
#include <string>

namespace gpu {

void set_opencl_kernel_source(std::string src);
bool load_opencl_kernel_file(const char* path, std::string* err);

class OpenClEngine {
public:
    OpenClEngine();
    ~OpenClEngine();
    OpenClEngine(const OpenClEngine&) = delete;
    OpenClEngine& operator=(const OpenClEngine&) = delete;

    bool init(const GpuDeviceInfo& info, std::string* err);
    bool hash_one(const uint8_t work[80], const uint8_t mask[32], uint8_t out[32], std::string* err);
    bool grind_batch(const uint8_t work[80], const uint8_t mask[32], const uint8_t target[32], uint32_t nonce_lo,
        uint32_t nonce_hi, uint32_t batch, OpenClFound* out, std::string* err);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace gpu
