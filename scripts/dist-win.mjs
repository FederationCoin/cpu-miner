import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

if (process.platform === 'win32') {
  run(process.execPath, [join(root, 'native/gpu-hasher/rebuild.mjs')]);
}

run(process.execPath, [join(root, 'scripts/assert-win-gpu-addon.mjs')]);
run(process.execPath, [join(root, 'node_modules/electron-builder/cli.js'), '--win', '--publish', 'never']);
