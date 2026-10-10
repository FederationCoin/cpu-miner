#include "grind.hpp"
#include "cuda_runtime.hpp"
#include "gpu_pow.hpp"
#include "grind_launch.hpp"
#include "opencl_engine.hpp"

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace gpu {
namespace {

struct Running {
    std::atomic<bool> stop{false};
    std::vector<std::thread> threads;
    std::mutex mu;
};

Running g_run;

void grind_loop(GpuJob job, FoundFn found, ProgressFn progress, LogFn log, DoneFn done, std::atomic<bool>* stop)
{
    struct DoneOnce {
        DoneFn fn;
        ~DoneOnce()
        {
            if (fn) {
                fn();
            }
        }
    } guard{std::move(done)};

    try {
        uint8_t mask[32];
        xor_key_mask_bytes(job.xor_key, job.xor_clear, mask);
        const bool cuda = job.device.backend == "cuda";
        CudaEngine cudaEng;
        OpenClEngine oclEng;
        std::string err;
        if (cuda) {
            if (!cudaEng.init(job.device, &err) || !cudaEng.load_job(job.work, mask, job.target, &err)) {
                if (log) {
                    log(std::string("gpu: ") + err);
                }
                return;
            }
        } else if (!oclEng.init(job.device, &err) || !oclEng.load_job(job.work, mask, job.target, &err)) {
            if (log) {
                log(std::string("gpu: ") + err);
            }
            return;
        }
        if (log) {
            log(std::string("gpu: hashing on ") + job.device.id);
        }
        uint64_t cursor = 0;
        uint64_t hashes = 0;
        while (!stop->load(std::memory_order_relaxed)) {
            OpenClFound hit{};
            const bool ok = cuda
                ? cudaEng.grind_batch(static_cast<uint32_t>(cursor), static_cast<uint32_t>(cursor >> 32),
                      kLaunchHashes, &hit, &err)
                : oclEng.grind_batch(static_cast<uint32_t>(cursor), static_cast<uint32_t>(cursor >> 32),
                      kLaunchHashes, &hit, &err);
            if (!ok) {
                if (log) {
                    log(std::string("gpu: ") + err);
                }
                break;
            }
            hashes += kLaunchHashes;
            if (progress) {
                progress(kLaunchHashes);
            }
            if (hit.hit) {
                if (found) {
                    found(hit.nonce, hit.nonce2, hashes);
                }
                break;
            }
            cursor += kLaunchHashes;
        }
    } catch (...) {
        if (log) {
            log("gpu: grind exception");
        }
    }
}

} // namespace

void stop_all_grinds()
{
    g_run.stop.store(true, std::memory_order_relaxed);
    std::vector<std::thread> join;
    {
        std::lock_guard<std::mutex> lock(g_run.mu);
        join.swap(g_run.threads);
    }
    for (auto& t : join) {
        if (t.joinable()) {
            t.join();
        }
    }
    g_run.stop.store(false, std::memory_order_relaxed);
}

bool start_device_grind(GpuJob job, FoundFn found, ProgressFn progress, LogFn log, DoneFn done)
{
    std::lock_guard<std::mutex> lock(g_run.mu);
    g_run.threads.emplace_back(grind_loop, std::move(job), std::move(found), std::move(progress), std::move(log),
        std::move(done), &g_run.stop);
    return true;
}

} // namespace gpu
