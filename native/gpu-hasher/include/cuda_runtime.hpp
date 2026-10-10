#pragma once

#include "opencl_runtime.hpp"

#include <memory>
#include <string>
#include <vector>

namespace gpu {

void set_cuda_ptx_source(std::string src);
bool cuda_ptx_loaded();
std::vector<GpuDeviceInfo> list_cuda_devices();

class CudaEngine {
public:
    CudaEngine();
    ~CudaEngine();
    CudaEngine(const CudaEngine&) = delete;
    CudaEngine& operator=(const CudaEngine&) = delete;

    bool init(const GpuDeviceInfo& info, std::string* err);
    bool load_job(const uint8_t work[80], const uint8_t mask[32], const uint8_t target[32], std::string* err);
    bool grind_batch(uint32_t nonce_lo, uint32_t nonce_hi, uint32_t batch, OpenClFound* out, std::string* err);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace gpu
