#include "gpu_pow.hpp"
#include "opencl_engine.hpp"
#include "opencl_runtime.hpp"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {

int hex_nibble(char c)
{
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return c - 'a' + 10;
    }
    if (c >= 'A' && c <= 'F') {
        return c - 'A' + 10;
    }
    return -1;
}

std::vector<uint8_t> parse_hex(const char* hex)
{
    std::vector<uint8_t> out;
    size_t n = std::strlen(hex);
    if (n % 2 != 0) {
        return out;
    }
    out.resize(n / 2);
    for (size_t i = 0; i < out.size(); ++i) {
        int hi = hex_nibble(hex[i * 2]);
        int lo = hex_nibble(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) {
            return {};
        }
        out[i] = uint8_t((hi << 4) | lo);
    }
    return out;
}

std::string to_hex(const uint8_t* p, size_t n)
{
    static const char* k = "0123456789abcdef";
    std::string s;
    s.resize(n * 2);
    for (size_t i = 0; i < n; ++i) {
        s[i * 2] = k[p[i] >> 4];
        s[i * 2 + 1] = k[p[i] & 0xf];
    }
    return s;
}

int g_fail = 0;

void expect_eq(const char* name, const uint8_t* got, const uint8_t* exp, size_t n)
{
    if (std::memcmp(got, exp, n) == 0) {
        std::printf("ok %s\n", name);
        return;
    }
    std::printf("FAIL %s\n  got %s\n  exp %s\n", name, to_hex(got, n).c_str(), to_hex(exp, n).c_str());
    ++g_fail;
}

void check_asic(const char* name, const char* work_hex, const char* xor_hex, uint8_t clear, const char* hash_hex)
{
    auto work = parse_hex(work_hex);
    auto xor_key = parse_hex(xor_hex);
    auto exp = parse_hex(hash_hex);
    if (work.size() != 80 || xor_key.size() != 16 || exp.size() != 32) {
        std::printf("FAIL %s parse\n", name);
        ++g_fail;
        return;
    }
    uint8_t out[32];
    gpu::asic_pow_hash(work.data(), xor_key.data(), clear, out);
    uint8_t display[32];
    for (int i = 0; i < 32; ++i) {
        display[i] = out[31 - i];
    }
    expect_eq(name, display, exp.data(), 32);
}

} // namespace

int main()
{
    // testdata/block_header_v2.json profile_0_time_offset (xor key zero).
    check_asic("profile_0_zero_key",
        "000000000000943aff74219e1f45899abfdf536373c0f2fc92e6fe58335cd0ad"
        "0df0ad0b4433221158020000efcdab897e6326906eaa52fe59e03a14f1dfb8dd"
        "5d6e78497e56a8a6e4f4fb4d385e43db",
        "00000000000000000000000000000000", 0, "4b495dcf05d70a49785b799b22284fbcd9dd1209237c53c87e4674b15587d704");

    // profile_0_time_offset_disabled_selector_255. m_xor_key reversed to host bytes.
    check_asic("profile_0_xor_clear_255",
        "000000000000943aff74219e1f45899abfdf536373c0f2fc92e6fe58335cd0ad"
        "ffffffff4433221188776655efcdab89544a71e01a4c041c727e86ec7cb2c68c"
        "62d9dcab0ee9b07cdaf1a59bf2e5d40b",
        "22222222222222221111111111111111", 255, "c31b24420d67f86e524f980a24a18e88f36c821046d5288251b5d88998c69f86");

    uint8_t zero_key[16]{};
    uint8_t mask[32];
    gpu::xor_key_mask_bytes(zero_key, 0, mask);
    uint8_t z32[32]{};
    expect_eq("zero_key_mask", mask, z32, 32);

    auto devices = gpu::list_opencl_devices();
    std::printf("listDevices %zu (OpenCL %s)\n", devices.size(), gpu::opencl_available() ? "loaded" : "absent");

    const char* gpu_test = std::getenv("FEDERATIONCOIN_GPU_TEST");
    if (gpu_test && gpu_test[0] != '\0' && gpu_test[0] != '0') {
        if (devices.empty()) {
            std::printf("FAIL FEDERATIONCOIN_GPU_TEST set but no OpenCL GPU\n");
            return 1;
        }
        const char* kpath = std::getenv("GPU_HASHER_KERNEL");
        if (!kpath) {
            kpath = "kernel/asic_pow.cl";
        }
        std::string err;
        if (!gpu::load_opencl_kernel_file(kpath, &err)) {
            std::printf("FAIL %s\n", err.c_str());
            return 1;
        }
        auto work = parse_hex(
            "000000000000943aff74219e1f45899abfdf536373c0f2fc92e6fe58335cd0ad"
            "0df0ad0b4433221158020000efcdab897e6326906eaa52fe59e03a14f1dfb8dd"
            "5d6e78497e56a8a6e4f4fb4d385e43db");
        uint8_t xor_key[16]{};
        uint8_t gpu_out[32];
        uint8_t cpu_out[32];
        gpu::asic_pow_hash(work.data(), xor_key, 0, cpu_out);
        if (!gpu::opencl_hash_one(devices[0], work.data(), xor_key, 0, gpu_out, &err)) {
            std::printf("FAIL opencl_hash_one %s\n", err.c_str());
            return 1;
        }
        expect_eq("opencl_matches_cpu", gpu_out, cpu_out, 32);
    }

    return g_fail ? 1 : 0;
}
