#include "grind.hpp"
#include "gpu_pow.hpp"
#include "opencl_engine.hpp"

#include <atomic>
#include <mutex>
#include <thread>
#include <vector>

namespace gpu {
namespace {

constexpr uint32_t kBatch = 1u << 18;

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
        OpenClEngine eng;
        std::string err;
        if (!eng.init(job.device, &err)) {
            if (log) {
                log(std::string("gpu: ") + err);
            }
            return;
        }
        uint64_t cursor = 0;
        uint64_t hashes = 0;
        while (!stop->load(std::memory_order_relaxed)) {
            OpenClFound hit{};
            if (!eng.grind_batch(job.work, mask, job.target, static_cast<uint32_t>(cursor),
                    static_cast<uint32_t>(cursor >> 32), kBatch, &hit, &err)) {
                if (log) {
                    log(std::string("gpu: ") + err);
                }
                break;
            }
            hashes += kBatch;
            if (progress) {
                progress(kBatch);
            }
            if (hit.hit) {
                if (found) {
                    found(hit.nonce, hit.nonce2, hashes);
                }
                break;
            }
            cursor += kBatch;
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
