# gpu-hasher (in-process OpenCL addon)

Node-API addon loaded by the Electron **main** process. It is the GPU
hasher, not a second app. The file `gpu-hasher.node` is a shared library
(Windows DLL, Linux `.so`, macOS dylib). The renderer never `dlopen`s it.

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
  kernel/asic_pow.cl    # also shipped in extraResources
  src/                  # blake2b, sha256, pow_cpu, OpenCL delay-load, N-API
  include/
  rebuild.mjs           # node-gyp against Electron headers
```

Packaged path: `process.resourcesPath/gpu-hasher/gpu-hasher.node`.
Dev: `native/gpu-hasher/build/Release/` or `dist/` after `npm run build:gpu`.

## N-API

- `listDevices()` → `{ id, name, vendor, memoryMiB, backend: "opencl", kind }[]`
- `setKernelSource(src)`
- `asicPowHash(work80, xorKey16, xorClear)` — CPU reference (tests)
- `startGrind(job, onProgress, onFound, onLog)`
- `stopGrind()`

`id` is `opencl:<platform>:<device>:<name>`. Missing saved ids are skipped
at Start; they do not fail the session.

OpenCL is **delay-loaded** (`OpenCL.dll` / `libOpenCL.so.1` /
OpenCL.framework). No vendor driver in the zip. No CUDA Toolkit. NVIDIA
uses the driver OpenCL ICD.

If the ICD is missing, `listDevices` returns `[]` and does not throw.

## Build

Electron 44 ABI (not stock Node):

```bash
npm run build:gpu
# FC_GPU_REQUIRED=1 fails the process if node-gyp fails (Package CI)
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
macOS clang) before electron-builder. `extraResources` copies
`native/gpu-hasher/dist/` (`gpu-hasher.node` + `asic_pow.cl`). `asar` is
false. `private: true`; `--publish never`. Do not `npm publish` this addon.
A WSL `pack:win` zip is CPU-only; it cannot emit a PE addon.
