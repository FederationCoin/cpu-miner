#include "opencl_engine.hpp"
#include "gpu_pow.hpp"

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <mutex>
#include <sstream>
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

using cl_int = int32_t;
using cl_uint = uint32_t;
using cl_ulong = uint64_t;
using cl_bool = uint32_t;
using cl_bitfield = uint64_t;
using cl_device_type = cl_bitfield;
using cl_command_queue_properties = cl_bitfield;
using cl_mem_flags = cl_bitfield;
using cl_platform_id = void*;
using cl_device_id = void*;
using cl_context = void*;
using cl_command_queue = void*;
using cl_mem = void*;
using cl_program = void*;
using cl_kernel = void*;

constexpr cl_int CL_SUCCESS = 0;
constexpr cl_uint CL_TRUE = 1;
constexpr cl_device_type CL_DEVICE_TYPE_GPU = 1u << 2;
constexpr cl_device_type CL_DEVICE_TYPE_ACCELERATOR = 1u << 3;
constexpr cl_uint CL_PLATFORM_NAME = 0x0902;
constexpr cl_uint CL_DEVICE_NAME = 0x102B;
constexpr cl_uint CL_DEVICE_VENDOR = 0x102C;
constexpr cl_uint CL_DEVICE_GLOBAL_MEM_SIZE = 0x101F;
constexpr cl_uint CL_DEVICE_HOST_UNIFIED_MEMORY = 0x1025;
constexpr cl_uint CL_PROGRAM_BUILD_LOG = 0x1183;
constexpr cl_mem_flags CL_MEM_READ_ONLY = 1u << 2;
constexpr cl_mem_flags CL_MEM_WRITE_ONLY = 1u << 1;
constexpr cl_mem_flags CL_MEM_READ_WRITE = 1u << 0;
constexpr cl_mem_flags CL_MEM_COPY_HOST_PTR = 1u << 5;

struct ClApi {
    cl_int (*GetPlatformIDs)(cl_uint, cl_platform_id*, cl_uint*);
    cl_int (*GetPlatformInfo)(cl_platform_id, cl_uint, size_t, void*, size_t*);
    cl_int (*GetDeviceIDs)(cl_platform_id, cl_device_type, cl_uint, cl_device_id*, cl_uint*);
    cl_int (*GetDeviceInfo)(cl_device_id, cl_uint, size_t, void*, size_t*);
    cl_context (*CreateContext)(const void*, cl_uint, const cl_device_id*, void*, void*, cl_int*);
    cl_int (*ReleaseContext)(cl_context);
    cl_command_queue (*CreateCommandQueue)(cl_context, cl_device_id, cl_command_queue_properties, cl_int*);
    cl_int (*ReleaseCommandQueue)(cl_command_queue);
    cl_mem (*CreateBuffer)(cl_context, cl_mem_flags, size_t, void*, cl_int*);
    cl_int (*ReleaseMemObject)(cl_mem);
    cl_program (*CreateProgramWithSource)(cl_context, cl_uint, const char**, const size_t*, cl_int*);
    cl_int (*BuildProgram)(cl_program, cl_uint, const cl_device_id*, const char*, void*, void*);
    cl_int (*GetProgramBuildInfo)(cl_program, cl_device_id, cl_uint, size_t, void*, size_t*);
    cl_int (*ReleaseProgram)(cl_program);
    cl_kernel (*CreateKernel)(cl_program, const char*, cl_int*);
    cl_int (*ReleaseKernel)(cl_kernel);
    cl_int (*SetKernelArg)(cl_kernel, cl_uint, size_t, const void*);
    cl_int (*EnqueueNDRangeKernel)(cl_command_queue, cl_kernel, cl_uint, const size_t*, const size_t*, const size_t*,
        cl_uint, const void*, void*);
    cl_int (*EnqueueWriteBuffer)(cl_command_queue, cl_mem, cl_bool, size_t, size_t, const void*, cl_uint, const void*,
        void*);
    cl_int (*EnqueueReadBuffer)(cl_command_queue, cl_mem, cl_bool, size_t, size_t, void*, cl_uint, const void*, void*);
    cl_int (*Finish)(cl_command_queue);
};

void* g_lib = nullptr;
ClApi g_api{};
std::mutex g_mu;
std::string g_kernel;

constexpr cl_uint kMaxPlatforms = 16;
constexpr cl_uint kMaxDevices = 64;
constexpr size_t kMaxInfoBytes = 4096;
constexpr size_t kMaxBuildLog = 64 * 1024;
constexpr uint32_t kMaxBatch = 1u << 20;
constexpr size_t kMaxKernelSource = 2 * 1024 * 1024;

struct ClMem {
    cl_mem p = nullptr;
    ClMem() = default;
    explicit ClMem(cl_mem x) : p(x) {}
    ~ClMem() { reset(); }
    ClMem(const ClMem&) = delete;
    ClMem& operator=(const ClMem&) = delete;
    void reset()
    {
        if (p && g_api.ReleaseMemObject) {
            g_api.ReleaseMemObject(p);
            p = nullptr;
        }
    }
};

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
    return static_cast<void*>(LoadLibraryW(L"OpenCL.dll"));
#elif defined(__APPLE__)
    void* h = dlopen("/System/Library/Frameworks/OpenCL.framework/OpenCL", RTLD_NOW);
    if (!h) {
        h = dlopen("/System/Library/Frameworks/OpenCL.framework/Versions/Current/OpenCL", RTLD_NOW);
    }
    return h;
#else
    void* h = dlopen("libOpenCL.so.1", RTLD_NOW);
    if (!h) {
        h = dlopen("libOpenCL.so", RTLD_NOW);
    }
    return h;
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
    if (g_api.GetPlatformIDs && g_api.Finish) {
        return true;
    }
    close_lib();
    g_lib = load_lib();
    if (!g_lib) {
        return false;
    }
    ClApi api{};
#define BIND(field, cname)                                                 \
    api.field = reinterpret_cast<decltype(api.field)>(proc(cname));       \
    if (!api.field) {                                                      \
        close_lib();                                                       \
        return false;                                                     \
    }
    BIND(GetPlatformIDs, "clGetPlatformIDs");
    BIND(GetPlatformInfo, "clGetPlatformInfo");
    BIND(GetDeviceIDs, "clGetDeviceIDs");
    BIND(GetDeviceInfo, "clGetDeviceInfo");
    BIND(CreateContext, "clCreateContext");
    BIND(ReleaseContext, "clReleaseContext");
    BIND(CreateCommandQueue, "clCreateCommandQueue");
    BIND(ReleaseCommandQueue, "clReleaseCommandQueue");
    BIND(CreateBuffer, "clCreateBuffer");
    BIND(ReleaseMemObject, "clReleaseMemObject");
    BIND(CreateProgramWithSource, "clCreateProgramWithSource");
    BIND(BuildProgram, "clBuildProgram");
    BIND(GetProgramBuildInfo, "clGetProgramBuildInfo");
    BIND(ReleaseProgram, "clReleaseProgram");
    BIND(CreateKernel, "clCreateKernel");
    BIND(ReleaseKernel, "clReleaseKernel");
    BIND(SetKernelArg, "clSetKernelArg");
    BIND(EnqueueNDRangeKernel, "clEnqueueNDRangeKernel");
    BIND(EnqueueWriteBuffer, "clEnqueueWriteBuffer");
    BIND(EnqueueReadBuffer, "clEnqueueReadBuffer");
    BIND(Finish, "clFinish");
#undef BIND
    g_api = api;
    return true;
}

std::string info_str(cl_int (*fn)(void*, cl_uint, size_t, void*, size_t*), void* obj, cl_uint key)
{
    size_t n = 0;
    if (fn(obj, key, 0, nullptr, &n) != CL_SUCCESS || n == 0) {
        return {};
    }
    n = (std::min)(n, kMaxInfoBytes);
    std::string s(n, '\0');
    if (fn(obj, key, n, s.data(), nullptr) != CL_SUCCESS) {
        return {};
    }
    while (!s.empty() && (s.back() == '\0' || s.back() == '\n')) {
        s.pop_back();
    }
    return s;
}

bool get_device(int platform_index, int device_index, cl_platform_id* plat, cl_device_id* dev)
{
    if (!bind_api()) {
        return false;
    }
    cl_uint np = 0;
    if (g_api.GetPlatformIDs(0, nullptr, &np) != CL_SUCCESS || np == 0) {
        return false;
    }
    np = (std::min)(np, kMaxPlatforms);
    std::vector<cl_platform_id> plats(np);
    if (g_api.GetPlatformIDs(np, plats.data(), nullptr) != CL_SUCCESS) {
        return false;
    }
    if (platform_index < 0 || static_cast<cl_uint>(platform_index) >= np) {
        return false;
    }
    *plat = plats[static_cast<size_t>(platform_index)];
    cl_uint nd = 0;
    cl_device_type types = CL_DEVICE_TYPE_GPU | CL_DEVICE_TYPE_ACCELERATOR;
    if (g_api.GetDeviceIDs(*plat, types, 0, nullptr, &nd) != CL_SUCCESS || nd == 0) {
        return false;
    }
    nd = (std::min)(nd, kMaxDevices);
    std::vector<cl_device_id> devs(nd);
    if (g_api.GetDeviceIDs(*plat, types, nd, devs.data(), nullptr) != CL_SUCCESS) {
        return false;
    }
    if (device_index < 0 || static_cast<cl_uint>(device_index) >= nd) {
        return false;
    }
    *dev = devs[static_cast<size_t>(device_index)];
    return true;
}

} // namespace

void set_opencl_kernel_source(std::string src)
{
    std::lock_guard<std::mutex> lock(g_mu);
    if (src.size() > kMaxKernelSource) {
        g_kernel.clear();
        return;
    }
    g_kernel = std::move(src);
}

bool load_opencl_kernel_file(const char* path, std::string* err)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        if (err) {
            *err = std::string("cannot read OpenCL kernel ") + path;
        }
        return false;
    }
    std::ostringstream ss;
    ss << in.rdbuf();
    set_opencl_kernel_source(ss.str());
    return true;
}

bool opencl_available() { return bind_api(); }

std::vector<GpuDeviceInfo> list_opencl_devices()
{
    std::vector<GpuDeviceInfo> out;
    if (!bind_api()) {
        return out;
    }
    cl_uint np = 0;
    if (g_api.GetPlatformIDs(0, nullptr, &np) != CL_SUCCESS || np == 0) {
        return out;
    }
    np = (std::min)(np, kMaxPlatforms);
    std::vector<cl_platform_id> plats(np);
    if (g_api.GetPlatformIDs(np, plats.data(), nullptr) != CL_SUCCESS) {
        return out;
    }
    for (cl_uint p = 0; p < np; ++p) {
        std::string pname = info_str(reinterpret_cast<cl_int (*)(void*, cl_uint, size_t, void*, size_t*)>(g_api.GetPlatformInfo),
            plats[p], CL_PLATFORM_NAME);
        cl_uint nd = 0;
        cl_device_type types = CL_DEVICE_TYPE_GPU | CL_DEVICE_TYPE_ACCELERATOR;
        if (g_api.GetDeviceIDs(plats[p], types, 0, nullptr, &nd) != CL_SUCCESS || nd == 0) {
            continue;
        }
        nd = (std::min)(nd, kMaxDevices);
        std::vector<cl_device_id> devs(nd);
        if (g_api.GetDeviceIDs(plats[p], types, nd, devs.data(), nullptr) != CL_SUCCESS) {
            continue;
        }
        for (cl_uint d = 0; d < nd; ++d) {
            GpuDeviceInfo info;
            info.platform_index = static_cast<int>(p);
            info.device_index = static_cast<int>(d);
            info.name = info_str(reinterpret_cast<cl_int (*)(void*, cl_uint, size_t, void*, size_t*)>(g_api.GetDeviceInfo),
                devs[d], CL_DEVICE_NAME);
            info.vendor = info_str(reinterpret_cast<cl_int (*)(void*, cl_uint, size_t, void*, size_t*)>(g_api.GetDeviceInfo),
                devs[d], CL_DEVICE_VENDOR);
            cl_ulong mem = 0;
            g_api.GetDeviceInfo(devs[d], CL_DEVICE_GLOBAL_MEM_SIZE, sizeof(mem), &mem, nullptr);
            info.memory_mib = mem / (1024ull * 1024ull);
            cl_bool unified = 0;
            g_api.GetDeviceInfo(devs[d], CL_DEVICE_HOST_UNIFIED_MEMORY, sizeof(unified), &unified, nullptr);
            info.kind = unified == CL_TRUE ? "integrated" : "discrete";
            info.id = "opencl:" + std::to_string(p) + ":" + std::to_string(d) + ":" + info.name;
            out.push_back(std::move(info));
            (void)pname;
        }
    }
    return out;
}

struct OpenClEngine::Impl {
    cl_context ctx = nullptr;
    cl_command_queue q = nullptr;
    cl_program prog = nullptr;
    cl_kernel grind = nullptr;
    cl_kernel one = nullptr;
    cl_device_id dev = nullptr;
};

OpenClEngine::OpenClEngine() : impl_(std::make_unique<Impl>()) {}

OpenClEngine::~OpenClEngine()
{
    if (!impl_ || !g_api.ReleaseContext) {
        return;
    }
    if (impl_->grind && g_api.ReleaseKernel) {
        g_api.ReleaseKernel(impl_->grind);
        impl_->grind = nullptr;
    }
    if (impl_->one && g_api.ReleaseKernel) {
        g_api.ReleaseKernel(impl_->one);
        impl_->one = nullptr;
    }
    if (impl_->prog && g_api.ReleaseProgram) {
        g_api.ReleaseProgram(impl_->prog);
        impl_->prog = nullptr;
    }
    if (impl_->q && g_api.ReleaseCommandQueue) {
        g_api.ReleaseCommandQueue(impl_->q);
        impl_->q = nullptr;
    }
    if (impl_->ctx) {
        g_api.ReleaseContext(impl_->ctx);
        impl_->ctx = nullptr;
    }
}

bool OpenClEngine::init(const GpuDeviceInfo& info, std::string* err)
{
    if (!bind_api()) {
        if (err) {
            *err = "OpenCL ICD not found";
        }
        return false;
    }
    std::string src;
    {
        std::lock_guard<std::mutex> lock(g_mu);
        src = g_kernel;
    }
    if (src.empty()) {
        if (err) {
            *err = "OpenCL kernel source not loaded";
        }
        return false;
    }
    cl_platform_id plat = nullptr;
    if (!get_device(info.platform_index, info.device_index, &plat, &impl_->dev)) {
        if (err) {
            *err = "OpenCL device not found";
        }
        return false;
    }
    cl_int e = 0;
    impl_->ctx = g_api.CreateContext(nullptr, 1, &impl_->dev, nullptr, nullptr, &e);
    if (!impl_->ctx || e != CL_SUCCESS) {
        if (err) {
            *err = "clCreateContext failed";
        }
        return false;
    }
    impl_->q = g_api.CreateCommandQueue(impl_->ctx, impl_->dev, 0, &e);
    if (!impl_->q || e != CL_SUCCESS) {
        if (err) {
            *err = "clCreateCommandQueue failed";
        }
        return false;
    }
    const char* srcp = src.c_str();
    size_t len = src.size();
    impl_->prog = g_api.CreateProgramWithSource(impl_->ctx, 1, &srcp, &len, &e);
    if (!impl_->prog || e != CL_SUCCESS) {
        if (err) {
            *err = "clCreateProgramWithSource failed";
        }
        return false;
    }
    e = g_api.BuildProgram(impl_->prog, 1, &impl_->dev, "", nullptr, nullptr);
    if (e != CL_SUCCESS) {
        size_t logn = 0;
        g_api.GetProgramBuildInfo(impl_->prog, impl_->dev, CL_PROGRAM_BUILD_LOG, 0, nullptr, &logn);
        logn = (std::min)(logn, kMaxBuildLog);
        std::string log(logn, '\0');
        if (logn) {
            g_api.GetProgramBuildInfo(impl_->prog, impl_->dev, CL_PROGRAM_BUILD_LOG, logn, log.data(), nullptr);
        }
        if (err) {
            *err = "clBuildProgram failed: " + log;
        }
        return false;
    }
    impl_->grind = g_api.CreateKernel(impl_->prog, "asic_pow_grind", &e);
    if (!impl_->grind || e != CL_SUCCESS) {
        if (err) {
            *err = "clCreateKernel asic_pow_grind failed";
        }
        return false;
    }
    impl_->one = g_api.CreateKernel(impl_->prog, "asic_pow_hash_one", &e);
    if (!impl_->one || e != CL_SUCCESS) {
        if (err) {
            *err = "clCreateKernel asic_pow_hash_one failed";
        }
        return false;
    }
    return true;
}

bool OpenClEngine::hash_one(const uint8_t work[80], const uint8_t mask[32], uint8_t out[32], std::string* err)
{
    if (!impl_->ctx || !impl_->q || !impl_->one || !g_api.CreateBuffer) {
        if (err) {
            *err = "OpenCL engine not initialized";
        }
        return false;
    }
    cl_int e = 0;
    uint8_t work_copy[80];
    uint8_t mask_copy[32];
    std::memcpy(work_copy, work, 80);
    std::memcpy(mask_copy, mask, 32);
    ClMem wbuf(g_api.CreateBuffer(impl_->ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, 80, work_copy, &e));
    if (!wbuf.p || e != CL_SUCCESS) {
        if (err) {
            *err = "clCreateBuffer failed";
        }
        return false;
    }
    ClMem mbuf(g_api.CreateBuffer(impl_->ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, 32, mask_copy, &e));
    if (!mbuf.p || e != CL_SUCCESS) {
        if (err) {
            *err = "clCreateBuffer failed";
        }
        return false;
    }
    ClMem obuf(g_api.CreateBuffer(impl_->ctx, CL_MEM_WRITE_ONLY, 32, nullptr, &e));
    if (!obuf.p || e != CL_SUCCESS) {
        if (err) {
            *err = "clCreateBuffer failed";
        }
        return false;
    }
    g_api.SetKernelArg(impl_->one, 0, sizeof(cl_mem), &wbuf.p);
    g_api.SetKernelArg(impl_->one, 1, sizeof(cl_mem), &mbuf.p);
    g_api.SetKernelArg(impl_->one, 2, sizeof(cl_mem), &obuf.p);
    size_t gsz = 1;
    e = g_api.EnqueueNDRangeKernel(impl_->q, impl_->one, 1, nullptr, &gsz, nullptr, 0, nullptr, nullptr);
    if (e != CL_SUCCESS) {
        if (err) {
            *err = "hash_one enqueue failed";
        }
        return false;
    }
    e = g_api.EnqueueReadBuffer(impl_->q, obuf.p, CL_TRUE, 0, 32, out, 0, nullptr, nullptr);
    if (e != CL_SUCCESS) {
        if (err) {
            *err = "hash_one read failed";
        }
        return false;
    }
    return true;
}

bool OpenClEngine::grind_batch(const uint8_t work[80], const uint8_t mask[32], const uint8_t target[32], uint32_t nonce_lo,
    uint32_t nonce_hi, uint32_t batch, OpenClFound* out, std::string* err)
{
    if (!out || batch == 0 || batch > kMaxBatch || !impl_->ctx || !impl_->q || !impl_->grind || !g_api.CreateBuffer) {
        if (err) {
            *err = "invalid grind_batch args";
        }
        return false;
    }
    cl_int e = 0;
    uint8_t work_copy[80];
    uint8_t mask_copy[32];
    uint8_t target_copy[32];
    std::memcpy(work_copy, work, 80);
    std::memcpy(mask_copy, mask, 32);
    std::memcpy(target_copy, target, 32);
    uint32_t found[3] = {0, 0, 0};
    ClMem wbuf(g_api.CreateBuffer(impl_->ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, 80, work_copy, &e));
    if (!wbuf.p || e != CL_SUCCESS) {
        if (err) {
            *err = "grind_batch clCreateBuffer failed";
        }
        return false;
    }
    ClMem mbuf(g_api.CreateBuffer(impl_->ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, 32, mask_copy, &e));
    if (!mbuf.p || e != CL_SUCCESS) {
        if (err) {
            *err = "grind_batch clCreateBuffer failed";
        }
        return false;
    }
    ClMem tbuf(g_api.CreateBuffer(impl_->ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, 32, target_copy, &e));
    if (!tbuf.p || e != CL_SUCCESS) {
        if (err) {
            *err = "grind_batch clCreateBuffer failed";
        }
        return false;
    }
    ClMem fbuf(g_api.CreateBuffer(impl_->ctx, CL_MEM_READ_WRITE | CL_MEM_COPY_HOST_PTR, sizeof(found), found, &e));
    if (!fbuf.p || e != CL_SUCCESS) {
        if (err) {
            *err = "grind_batch clCreateBuffer failed";
        }
        return false;
    }
    g_api.SetKernelArg(impl_->grind, 0, sizeof(cl_mem), &wbuf.p);
    g_api.SetKernelArg(impl_->grind, 1, sizeof(cl_mem), &mbuf.p);
    g_api.SetKernelArg(impl_->grind, 2, sizeof(cl_mem), &tbuf.p);
    g_api.SetKernelArg(impl_->grind, 3, sizeof(uint32_t), &nonce_lo);
    g_api.SetKernelArg(impl_->grind, 4, sizeof(uint32_t), &nonce_hi);
    g_api.SetKernelArg(impl_->grind, 5, sizeof(cl_mem), &fbuf.p);
    size_t gsz = batch;
    e = g_api.EnqueueNDRangeKernel(impl_->q, impl_->grind, 1, nullptr, &gsz, nullptr, 0, nullptr, nullptr);
    if (e != CL_SUCCESS) {
        if (err) {
            *err = "grind_batch enqueue failed";
        }
        return false;
    }
    e = g_api.EnqueueReadBuffer(impl_->q, fbuf.p, CL_TRUE, 0, sizeof(found), found, 0, nullptr, nullptr);
    if (e != CL_SUCCESS) {
        if (err) {
            *err = "grind_batch read failed";
        }
        return false;
    }
    out->hit = found[0] != 0;
    out->nonce = found[1];
    out->nonce2 = found[2];
    return true;
}

bool opencl_hash_batch(const GpuDeviceInfo& dev, const uint8_t work[80], const uint8_t xor_key[16], uint8_t xor_clear,
    const uint8_t target[32], uint32_t nonce_lo, uint32_t nonce_hi, uint32_t batch, OpenClFound* out, std::string* err)
{
    OpenClEngine eng;
    if (!eng.init(dev, err)) {
        return false;
    }
    uint8_t mask[32];
    xor_key_mask_bytes(xor_key, xor_clear, mask);
    return eng.grind_batch(work, mask, target, nonce_lo, nonce_hi, batch, out, err);
}

bool opencl_hash_one(const GpuDeviceInfo& dev, const uint8_t work[80], const uint8_t xor_key[16], uint8_t xor_clear,
    uint8_t out[32], std::string* err)
{
    OpenClEngine eng;
    if (!eng.init(dev, err)) {
        return false;
    }
    uint8_t mask[32];
    xor_key_mask_bytes(xor_key, xor_clear, mask);
    return eng.hash_one(work, mask, out, err);
}

} // namespace gpu
