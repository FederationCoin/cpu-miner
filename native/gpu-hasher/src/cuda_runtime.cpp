#include "cuda_runtime.hpp"
#include "grind_launch.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace gpu {
namespace {

using CUresult = int;
using CUdevice = int;
using CUcontext = void*;
using CUmodule = void*;
using CUfunction = void*;
using CUdeviceptr = unsigned long long;
using CUstream = void*;

constexpr CUresult CUDA_SUCCESS = 0;
constexpr unsigned kMaxName = 256;

struct CuApi {
    CUresult (*Init)(unsigned);
    CUresult (*DeviceGetCount)(int*);
    CUresult (*DeviceGet)(CUdevice*, int);
    CUresult (*DeviceGetName)(char*, int, CUdevice);
    CUresult (*DeviceTotalMem)(size_t*, CUdevice);
    CUresult (*CtxCreate)(CUcontext*, unsigned, CUdevice);
    CUresult (*CtxDestroy)(CUcontext);
    CUresult (*ModuleLoadData)(CUmodule*, const void*);
    CUresult (*ModuleGetFunction)(CUfunction*, CUmodule, const char*);
    CUresult (*ModuleUnload)(CUmodule);
    CUresult (*MemAlloc)(CUdeviceptr*, size_t);
    CUresult (*MemFree)(CUdeviceptr);
    CUresult (*MemcpyHtoD)(CUdeviceptr, const void*, size_t);
    CUresult (*MemcpyDtoH)(void*, CUdeviceptr, size_t);
    CUresult (*LaunchKernel)(CUfunction, unsigned, unsigned, unsigned, unsigned, unsigned, unsigned, unsigned, CUstream,
        void**, void**);
    CUresult (*CtxSynchronize)();
    CUresult (*StreamCreate)(CUstream*, unsigned);
    CUresult (*StreamDestroy)(CUstream);
    CUresult (*StreamSynchronize)(CUstream);
};

void* g_lib = nullptr;
CuApi g_api{};
std::mutex g_mu;
std::string g_ptx;

void close_lib()
{
    if (!g_lib) {
        return;
    }
#ifdef _WIN32
    FreeLibrary(static_cast<HMODULE>(g_lib));
#else
    dlclose(g_lib);
#endif
    g_lib = nullptr;
    g_api = {};
}

void* load_lib()
{
#ifdef _WIN32
    return static_cast<void*>(LoadLibraryW(L"nvcuda.dll"));
#else
    const char* names[] = {"/usr/lib/wsl/lib/libcuda.so.1", "libcuda.so.1", "libcuda.so"};
    for (const char* n : names) {
        void* h = dlopen(n, RTLD_NOW);
        if (h) {
            return h;
        }
    }
    return nullptr;
#endif
}

void* proc(const char* name)
{
#ifdef _WIN32
    return reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(g_lib), name));
#else
    return dlsym(g_lib, name);
#endif
}

bool bind_api()
{
    std::lock_guard<std::mutex> lock(g_mu);
    if (g_api.Init && g_api.StreamSynchronize) {
        return true;
    }
    close_lib();
    g_lib = load_lib();
    if (!g_lib) {
        return false;
    }
    CuApi api{};
#define BIND(field, cname)                                           \
    api.field = reinterpret_cast<decltype(api.field)>(proc(cname)); \
    if (!api.field) {                                                \
        close_lib();                                                 \
        return false;                                                \
    }
    BIND(Init, "cuInit");
    BIND(DeviceGetCount, "cuDeviceGetCount");
    BIND(DeviceGet, "cuDeviceGet");
    BIND(DeviceGetName, "cuDeviceGetName");
    BIND(DeviceTotalMem, "cuDeviceTotalMem_v2");
    BIND(CtxCreate, "cuCtxCreate_v2");
    BIND(CtxDestroy, "cuCtxDestroy_v2");
    BIND(ModuleLoadData, "cuModuleLoadData");
    BIND(ModuleGetFunction, "cuModuleGetFunction");
    BIND(ModuleUnload, "cuModuleUnload");
    BIND(MemAlloc, "cuMemAlloc_v2");
    BIND(MemFree, "cuMemFree_v2");
    BIND(MemcpyHtoD, "cuMemcpyHtoD_v2");
    BIND(MemcpyDtoH, "cuMemcpyDtoH_v2");
    BIND(LaunchKernel, "cuLaunchKernel");
    BIND(CtxSynchronize, "cuCtxSynchronize");
    BIND(StreamCreate, "cuStreamCreate");
    BIND(StreamDestroy, "cuStreamDestroy_v2");
    BIND(StreamSynchronize, "cuStreamSynchronize");
#undef BIND
    if (api.Init(0) != CUDA_SUCCESS) {
        close_lib();
        return false;
    }
    g_api = api;
    return true;
}

} // namespace

void set_cuda_ptx_source(std::string src)
{
    std::lock_guard<std::mutex> lock(g_mu);
    g_ptx = std::move(src);
}

std::vector<GpuDeviceInfo> list_cuda_devices()
{
    std::vector<GpuDeviceInfo> out;
    if (!bind_api()) {
        return out;
    }
    int n = 0;
    if (g_api.DeviceGetCount(&n) != CUDA_SUCCESS || n <= 0) {
        return out;
    }
    for (int i = 0; i < n; ++i) {
        CUdevice dev = 0;
        if (g_api.DeviceGet(&dev, i) != CUDA_SUCCESS) {
            continue;
        }
        char name[kMaxName];
        name[0] = 0;
        g_api.DeviceGetName(name, static_cast<int>(kMaxName), dev);
        name[kMaxName - 1] = 0;
        size_t mem = 0;
        g_api.DeviceTotalMem(&mem, dev);
        GpuDeviceInfo info;
        info.device_index = i;
        info.name = name;
        info.vendor = "NVIDIA";
        info.memory_mib = mem / (1024ull * 1024ull);
        info.kind = "discrete";
        info.backend = "cuda";
        info.id = std::string("cuda:") + std::to_string(i) + ":" + info.name;
        out.push_back(std::move(info));
    }
    return out;
}

struct CudaEngine::Impl {
    CUcontext ctx = nullptr;
    CUmodule mod = nullptr;
    CUfunction grind = nullptr;
    CUstream stream = nullptr;
    CUdeviceptr work = 0;
    CUdeviceptr mask = 0;
    CUdeviceptr target = 0;
    CUdeviceptr found = 0;
    bool job_loaded = false;
};

CudaEngine::CudaEngine() : impl_(std::make_unique<Impl>()) {}

CudaEngine::~CudaEngine()
{
    if (!impl_ || !g_api.MemFree) {
        return;
    }
    if (impl_->work) {
        g_api.MemFree(impl_->work);
    }
    if (impl_->mask) {
        g_api.MemFree(impl_->mask);
    }
    if (impl_->target) {
        g_api.MemFree(impl_->target);
    }
    if (impl_->found) {
        g_api.MemFree(impl_->found);
    }
    if (impl_->stream && g_api.StreamDestroy) {
        g_api.StreamDestroy(impl_->stream);
    }
    if (impl_->mod && g_api.ModuleUnload) {
        g_api.ModuleUnload(impl_->mod);
    }
    if (impl_->ctx && g_api.CtxDestroy) {
        g_api.CtxDestroy(impl_->ctx);
    }
}

bool CudaEngine::init(const GpuDeviceInfo& info, std::string* err)
{
    if (!bind_api()) {
        if (err) {
            *err = "CUDA driver not found";
        }
        return false;
    }
    std::string ptx;
    {
        std::lock_guard<std::mutex> lock(g_mu);
        ptx = g_ptx;
    }
    if (ptx.empty()) {
        if (err) {
            *err = "CUDA PTX not loaded";
        }
        return false;
    }
    CUdevice dev = 0;
    if (g_api.DeviceGet(&dev, info.device_index) != CUDA_SUCCESS) {
        if (err) {
            *err = "CUDA device not found";
        }
        return false;
    }
    if (g_api.CtxCreate(&impl_->ctx, 0, dev) != CUDA_SUCCESS || !impl_->ctx) {
        if (err) {
            *err = "cuCtxCreate failed";
        }
        return false;
    }
    if (g_api.ModuleLoadData(&impl_->mod, ptx.c_str()) != CUDA_SUCCESS || !impl_->mod) {
        if (err) {
            *err = "cuModuleLoadData failed";
        }
        return false;
    }
    if (g_api.ModuleGetFunction(&impl_->grind, impl_->mod, "asic_pow_grind") != CUDA_SUCCESS || !impl_->grind) {
        if (err) {
            *err = "cuModuleGetFunction asic_pow_grind failed";
        }
        return false;
    }
    if (g_api.MemAlloc(&impl_->work, 80) != CUDA_SUCCESS || g_api.MemAlloc(&impl_->mask, 32) != CUDA_SUCCESS
        || g_api.MemAlloc(&impl_->target, 32) != CUDA_SUCCESS || g_api.MemAlloc(&impl_->found, 12) != CUDA_SUCCESS) {
        if (err) {
            *err = "cuMemAlloc failed";
        }
        return false;
    }
    if (g_api.StreamCreate(&impl_->stream, 0) != CUDA_SUCCESS || !impl_->stream) {
        if (err) {
            *err = "cuStreamCreate failed";
        }
        return false;
    }
    return true;
}

bool CudaEngine::load_job(const uint8_t work[80], const uint8_t mask[32], const uint8_t target[32], std::string* err)
{
    if (!impl_->work || !impl_->mask || !impl_->target) {
        if (err) {
            *err = "CUDA engine not initialized";
        }
        return false;
    }
    if (g_api.MemcpyHtoD(impl_->work, work, 80) != CUDA_SUCCESS || g_api.MemcpyHtoD(impl_->mask, mask, 32) != CUDA_SUCCESS
        || g_api.MemcpyHtoD(impl_->target, target, 32) != CUDA_SUCCESS) {
        if (err) {
            *err = "cuMemcpyHtoD job failed";
        }
        return false;
    }
    impl_->job_loaded = true;
    return true;
}

bool CudaEngine::grind_batch(uint32_t nonce_lo, uint32_t nonce_hi, uint32_t batch, OpenClFound* out, std::string* err)
{
    const uint32_t stride = kBlockThreads * kHashesPerThread;
    if (!out || batch == 0 || batch % stride != 0 || !impl_->grind || !impl_->job_loaded || !impl_->stream) {
        if (err) {
            *err = "invalid CUDA grind_batch args";
        }
        return false;
    }
    unsigned int found[3] = {0, 0, 0};
    if (g_api.MemcpyHtoD(impl_->found, found, sizeof(found)) != CUDA_SUCCESS) {
        if (err) {
            *err = "cuMemcpyHtoD found failed";
        }
        return false;
    }
    CUdeviceptr workp = impl_->work;
    CUdeviceptr maskp = impl_->mask;
    CUdeviceptr targetp = impl_->target;
    CUdeviceptr foundp = impl_->found;
    unsigned int iter = kHashesPerThread;
    void* args[] = {&workp, &maskp, &targetp, &nonce_lo, &nonce_hi, &iter, &foundp};
    unsigned grid = (batch / kHashesPerThread) / kBlockThreads;
    if (g_api.LaunchKernel(impl_->grind, grid, 1, 1, kBlockThreads, 1, 1, 0, impl_->stream, args, nullptr)
        != CUDA_SUCCESS) {
        if (err) {
            *err = "cuLaunchKernel failed";
        }
        return false;
    }
    if (g_api.StreamSynchronize(impl_->stream) != CUDA_SUCCESS) {
        if (err) {
            *err = "cuStreamSynchronize failed";
        }
        return false;
    }
    if (g_api.MemcpyDtoH(found, impl_->found, sizeof(found)) != CUDA_SUCCESS) {
        if (err) {
            *err = "cuMemcpyDtoH failed";
        }
        return false;
    }
    out->hit = found[0] != 0;
    out->nonce = found[1];
    out->nonce2 = found[2];
    return true;
}

} // namespace gpu
