#include "cuda_runtime.hpp"
#include "gpu_pow.hpp"
#include "grind.hpp"
#include "opencl_engine.hpp"
#include "opencl_runtime.hpp"

#include <napi.h>

#include <cstring>
#include <string>
#include <vector>

namespace {

std::vector<gpu::GpuDeviceInfo> list_pow_devices()
{
    std::vector<gpu::GpuDeviceInfo> list;
    try {
        list = gpu::list_cuda_devices();
    } catch (...) {
        list.clear();
    }
    if (list.empty()) {
        try {
            list = gpu::list_opencl_devices();
        } catch (...) {
            list.clear();
        }
    }
    return list;
}

bool copy_buf(const Napi::Value& v, uint8_t* dst, size_t n)
{
    if (!dst || n == 0) {
        return false;
    }
    if (v.IsBuffer()) {
        auto buf = v.As<Napi::Buffer<uint8_t>>();
        if (buf.Length() < n || buf.Data() == nullptr) {
            return false;
        }
        std::memcpy(dst, buf.Data(), n);
        return true;
    }
    if (v.IsTypedArray()) {
        Napi::TypedArray ta = v.As<Napi::TypedArray>();
        if (ta.TypedArrayType() != napi_uint8_array || ta.ElementLength() < n) {
            return false;
        }
        auto u8 = v.As<Napi::Uint8Array>();
        if (u8.Data() == nullptr) {
            return false;
        }
        std::memcpy(dst, u8.Data(), n);
        return true;
    }
    return false;
}

Napi::Value ListDevices(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    std::vector<gpu::GpuDeviceInfo> list;
    try {
        list = list_pow_devices();
    } catch (...) {
        return Napi::Array::New(env, 0);
    }
    Napi::Array arr = Napi::Array::New(env, list.size());
    for (uint32_t i = 0; i < list.size(); ++i) {
        const auto& d = list[i];
        Napi::Object o = Napi::Object::New(env);
        o.Set("id", d.id);
        o.Set("name", d.name);
        o.Set("vendor", d.vendor);
        o.Set("memoryMiB", Napi::Number::New(env, static_cast<double>(d.memory_mib)));
            o.Set("backend", d.backend.empty() ? "opencl" : d.backend);
        o.Set("kind", d.kind);
        arr.Set(i, o);
    }
    return arr;
}

Napi::Value SetPtxSource(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "ptx source string").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    std::string src = info[0].As<Napi::String>().Utf8Value();
    if (src.size() > 2 * 1024 * 1024) {
        Napi::TypeError::New(env, "ptx source too large").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    gpu::set_cuda_ptx_source(std::move(src));
    return env.Undefined();
}

Napi::Value SetKernelSource(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "kernel source string").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    std::string src = info[0].As<Napi::String>().Utf8Value();
    if (src.size() > 2 * 1024 * 1024) {
        Napi::TypeError::New(env, "kernel source too large").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    gpu::set_opencl_kernel_source(std::move(src));
    return env.Undefined();
}

Napi::Value AsicPowHash(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 3) {
        Napi::TypeError::New(env, "work, xorKey, xorClear").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!info[2].IsNumber()) {
        Napi::TypeError::New(env, "xorClear number").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    uint8_t work[80];
    uint8_t xor_key[16];
    if (!copy_buf(info[0], work, 80) || !copy_buf(info[1], xor_key, 16)) {
        Napi::TypeError::New(env, "work 80 / xorKey 16").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    uint8_t clear = static_cast<uint8_t>(info[2].As<Napi::Number>().Uint32Value());
    uint8_t out[32];
    gpu::asic_pow_hash(work, xor_key, clear, out);
    return Napi::Buffer<uint8_t>::Copy(env, out, 32);
}

Napi::Value StopGrind(const Napi::CallbackInfo& info)
{
    gpu::stop_all_grinds();
    return info.Env().Undefined();
}

Napi::Value StartGrind(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 4 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "job, onProgress, onFound, onLog").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!info[1].IsFunction() || !info[2].IsFunction() || !info[3].IsFunction()) {
        Napi::TypeError::New(env, "job, onProgress, onFound, onLog").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Object job = info[0].As<Napi::Object>();
    if (!job.Get("deviceId").IsString()) {
        Napi::TypeError::New(env, "deviceId string").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    auto devices = list_pow_devices();
    std::string id = job.Get("deviceId").As<Napi::String>().Utf8Value();
    gpu::GpuDeviceInfo match;
    bool ok = false;
    for (const auto& d : devices) {
        if (d.id == id) {
            match = d;
            ok = true;
            break;
        }
    }
    if (!ok) {
        Napi::Error::New(env, "unknown GPU id").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    gpu::GpuJob gj;
    gj.device = match;
    if (!copy_buf(job.Get("work"), gj.work, 80) || !copy_buf(job.Get("target"), gj.target, 32)
        || !copy_buf(job.Get("xorKey"), gj.xor_key, 16) || !copy_buf(job.Get("extraNonce2"), gj.extra_nonce2, 8)) {
        Napi::TypeError::New(env, "job buffers").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!job.Get("xorClear").IsNumber() || !job.Get("gen").IsNumber()) {
        Napi::TypeError::New(env, "xorClear / gen").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    gj.xor_clear = static_cast<uint8_t>(job.Get("xorClear").As<Napi::Number>().Uint32Value());
    gj.gen = job.Get("gen").As<Napi::Number>().Uint32Value();

    auto tsfn_progress = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "gpu-progress", 0, 1);
    auto tsfn_found = Napi::ThreadSafeFunction::New(env, info[2].As<Napi::Function>(), "gpu-found", 0, 1);
    auto tsfn_log = Napi::ThreadSafeFunction::New(env, info[3].As<Napi::Function>(), "gpu-log", 0, 1);

    gpu::start_device_grind(
        gj,
        [tsfn_found](uint32_t nonce, uint32_t nonce2, uint64_t hashes) mutable {
            tsfn_found.NonBlockingCall([nonce, nonce2, hashes](Napi::Env env, Napi::Function cb) {
                Napi::Object o = Napi::Object::New(env);
                o.Set("type", "found");
                o.Set("nonce", nonce);
                o.Set("nonce2", nonce2);
                o.Set("hashes", hashes);
                cb.Call({o});
            });
        },
        [tsfn_progress](uint64_t hashes) mutable {
            tsfn_progress.NonBlockingCall([hashes](Napi::Env env, Napi::Function cb) {
                cb.Call({Napi::Number::New(env, static_cast<double>(hashes))});
            });
        },
        [tsfn_log](const std::string& msg) mutable {
            tsfn_log.NonBlockingCall([msg](Napi::Env env, Napi::Function cb) { cb.Call({Napi::String::New(env, msg)}); });
        },
        [tsfn_found, tsfn_progress, tsfn_log]() mutable {
            tsfn_found.Release();
            tsfn_progress.Release();
            tsfn_log.Release();
        });
    return env.Undefined();
}

} // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("listDevices", Napi::Function::New(env, ListDevices));
    exports.Set("setKernelSource", Napi::Function::New(env, SetKernelSource));
    exports.Set("setPtxSource", Napi::Function::New(env, SetPtxSource));
    exports.Set("asicPowHash", Napi::Function::New(env, AsicPowHash));
    exports.Set("startGrind", Napi::Function::New(env, StartGrind));
    exports.Set("stopGrind", Napi::Function::New(env, StopGrind));
    return exports;
}

NODE_API_MODULE(gpu_hasher, Init)
