#pragma once

#include <cstdint>

namespace gpu {

// pyblock gpu_grind.c: 512 hashes/thread, ~2^21 threads, header uploaded once.
constexpr uint32_t kHashesPerThread = 512;
constexpr uint32_t kBlockThreads = 256;
constexpr uint32_t kGridThreads = 1u << 21;
constexpr uint32_t kLaunchHashes = kGridThreads * kHashesPerThread;

} // namespace gpu
