import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'native/gpu-hasher/dist');
const nodePath = join(dist, 'gpu-hasher.node');
const clPath = join(dist, 'asic_pow.cl');
const ptxPath = join(dist, 'asic_pow.ptx');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!existsSync(nodePath)) {
  fail(
    `missing ${nodePath}\nWSL node-gyp cannot emit a Windows gpu-hasher.node. Copy a PE addon from Package windows-2022 (extraResources) into native/gpu-hasher/dist/, plus asic_pow.ptx from nvcc.`,
  );
}

const magic = readFileSync(nodePath).subarray(0, 2);
if (magic[0] !== 0x4d || magic[1] !== 0x5a) {
  fail(
    `${nodePath} is not a Windows PE (MZ). Do not run build:gpu on Linux before electron-builder --win; that packs an ELF the Windows app cannot load.`,
  );
}

if (!existsSync(clPath)) {
  fail(`missing ${clPath} (batched OpenCL kernel must sit next to the PE addon)`);
}

if (!existsSync(ptxPath)) {
  fail(
    `missing ${ptxPath}. CUDA grind needs PTX from nvcc at pack time. Package windows-2022 installs the CUDA Toolkit and runs nvcc; WSL dist:win can use a local nvcc copy of asic_pow.ptx next to a PE addon.`,
  );
}

console.log(`Windows GPU addon: PE ${nodePath}`);
console.log(`PTX: ${ptxPath}`);
