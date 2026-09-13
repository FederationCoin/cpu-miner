import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const require = createRequire(join(root, 'package.json'));
const required = process.env.FC_GPU_REQUIRED === '1';

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(required ? code : 0);
}

let electronVersion = '44.3.0';
try {
  electronVersion = require('electron/package.json').version;
} catch {
  fail('electron package missing; skip gpu-hasher.node');
}

let gypJs;
try {
  gypJs = require.resolve('node-gyp/bin/node-gyp.js');
} catch {
  fail('node-gyp package missing; skip gpu-hasher.node');
}

// Drive node-gyp.js with this Node. spawnSync('npx.cmd') without a shell
// does not run .cmd files on Windows (ENOENT / EINVAL, no compiler output).
const gyp = spawnSync(
  process.execPath,
  [
    gypJs,
    'rebuild',
    `--target=${electronVersion}`,
    `--arch=${process.arch}`,
    '--dist-url=https://electronjs.org/headers',
  ],
  { cwd: here, stdio: 'inherit', env: process.env },
);

const dist = join(here, 'dist');
mkdirSync(dist, { recursive: true });
copyFileSync(join(here, 'kernel', 'asic_pow.cl'), join(dist, 'asic_pow.cl'));

if (gyp.error) {
  console.error(gyp.error);
}
if (gyp.status !== 0) {
  fail(
    `gpu-hasher.node build failed (status=${gyp.status} signal=${gyp.signal}; CPU mining still works if the addon is absent)`,
  );
}

const built = join(here, 'build', 'Release', 'gpu-hasher.node');
copyFileSync(built, join(dist, 'gpu-hasher.node'));
console.log(`gpu-hasher.node Electron ${electronVersion} -> ${dist}`);
