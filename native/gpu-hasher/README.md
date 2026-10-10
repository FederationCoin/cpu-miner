# gpu-hasher (in-process OpenCL / CUDA addon)

Node-API addon loaded by the Electron **main** process. It is the native GPU
hasher, not a second app. The file `gpu-hasher.node` is a shared library
(Windows DLL, Linux `.so`, macOS dylib). The renderer never `dlopen`s it.
WebGPU grind runs in the renderer (WGSL), not in this addon. There is no HIP
kernel.

CPU `worker_threads` in `miner/worker.ts` stay as they are. GPU search uses
`extraNonce2 = 64 + g` (little-endian uint32 in the first four bytes) so it
cannot collide with 64 CPU workers (indices 0..63).

PoW is **blake2b-256 of the 80-byte DATUM/profile-0 work**, XOR mask,
byte-reverse, then target compare. Not SHA256d. Not an unmodified Sia /
ccminer kernel.

## Layout

```text
native/gpu-hasher/
  binding.gyp
  Makefile              # CPU-reference test (no Electron ABI)
  kernel/asic_pow.cl    # always shipped in extraResources
  kernel/asic_pow.cu    # nvcc -ptx → dist/asic_pow.ptx when nvcc is present
  src/                  # blake2b, sha256, pow_cpu, OpenCL/CUDA delay-load, N-API
  include/
  rebuild.mjs           # node-gyp against Electron headers
```

Packaged path: `process.resourcesPath/gpu-hasher/gpu-hasher.node`.
Dev: `native/gpu-hasher/build/Release/` or `dist/` after `npm run build:gpu`.

## N-API

- `listDevices()` → CUDA devices (only if `asic_pow.ptx` was loaded) and OpenCL devices
- `setKernelSource(src)`
- `setPtxSource(src)`
- `asicPowHash(work80, xorKey16, xorClear)` — CPU reference (tests)
- `startGrind(job, onProgress, onFound, onLog)`
- `stopGrind()`

CUDA ids are `cuda:<index>:<name>`. OpenCL ids are `opencl:<platform>:<device>:<name>`.
The UI groups both under one adapter and picks a strategy with radios. Missing
picks are skipped at Start; they do not fail the session.

OpenCL is **delay-loaded** (`OpenCL.dll` / `libOpenCL.so.1` /
OpenCL.framework). CUDA listing uses the driver (`nvcuda`). CUDA grind needs
`asic_pow.ptx` (nvcc at **build** time, not at run time). No HIP.

If both ICDs are missing, `listDevices` returns `[]` and does not throw.

## Build

Electron 44 ABI (not stock Node):

```bash
npm run build:gpu
# FC_GPU_REQUIRED=1 fails the process if node-gyp fails (Package CI)
# nvcc missing: OpenCL still works; CUDA is not listed
```

CPU-reference test (CI, no GPU):

```bash
make -C native/gpu-hasher test
```

OpenCL vs CPU on a machine with a GPU:

```bash
FEDERATIONCOIN_GPU_TEST=1 make -C native/gpu-hasher test
```

`npm test` always runs the CPU-reference binary. It does not skip those
cases when OpenCL is absent.

## Package

[`package.yaml`](../../.github/workflows/package.yaml) runs `npm run build:gpu`
with `FC_GPU_REQUIRED=1` on each OS runner (Linux g++, Windows MSVC,
macOS clang) before electron-builder. On **windows-2022** and **ubuntu-22.04
x64** the job installs the CUDA Toolkit so `nvcc -ptx` writes `asic_pow.ptx`.
macOS and linux-arm64 do not. `extraResources` copies
`native/gpu-hasher/dist/` (`gpu-hasher.node` + `asic_pow.cl`, and `asic_pow.ptx`
when nvcc ran). `asar` is false. `private: true`; `--publish never`. Do not
`npm publish` this addon. Do not vendor PTX in git.

## Windows GPU pack

Two different working products:

- **WSL / Linux Electron** (`npm start`): Linux ELF `gpu-hasher.node` +
  `asic_pow.ptx` from local nvcc. This is the fast CUDA path (`cuda:0`).
- **Windows exe**: PE `gpu-hasher.node` from Package `windows-2022` (MSVC +
  nvcc on that runner), not from WSL `node-gyp`.

Do **not** run `npm run build:gpu` on Linux before `electron-builder --win`.
That overwrites `dist/gpu-hasher.node` with an ELF and Windows Electron cannot
load it (Detect falls back to slow WebGPU). `npm run dist:win` runs `build:gpu`
only on `win32`, then asserts the addon is PE (`MZ`) and that `asic_pow.ptx`
and `asic_pow.cl` exist.

Inner-loop batching (`kHashesPerThread = 512`, large `kLaunchHashes` in
`grind_launch.hpp`) is required for multi-GH/s CUDA. An OpenCL-only PE from
before that change (Sep 2026 `ce2becf` era, host `1<<18` batches, no CUDA) is
the slow pack. A WSL `pack:win` zip cannot emit a PE addon; it copies
`asic_pow.ptx` only if that file already exists.

