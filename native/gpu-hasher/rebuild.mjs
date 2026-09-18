import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
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

function envHasCl(env) {
  const pathVar = env.Path || env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of pathVar.split(sep)) {
    if (!dir) {
      continue;
    }
    if (existsSync(join(dir, 'cl.exe')) || existsSync(join(dir, 'cl'))) {
      return true;
    }
  }
  return false;
}

/** nvcc -ptx needs the MSVC host compiler on PATH. node-gyp/MSBuild already found VS. */
function msvcEnv(env) {
  if (process.platform !== 'win32' || envHasCl(env)) {
    return env;
  }
  const vswhere = join(
    env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  );
  if (!existsSync(vswhere)) {
    return env;
  }
  const found = spawnSync(
    vswhere,
    ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    { encoding: 'utf8' },
  );
  const install = (found.stdout || '').trim();
  if (!install) {
    return env;
  }
  const vcvars = join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!existsSync(vcvars)) {
    return env;
  }
  const dumped = spawnSync('cmd.exe', ['/d', '/s', '/c', `call "${vcvars}" && set`], { encoding: 'utf8', env });
  if (dumped.status !== 0 || !dumped.stdout) {
    return env;
  }
  const next = { ...env };
  for (const line of dumped.stdout.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) {
      continue;
    }
    const key = line.slice(0, i);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    next[key] = line.slice(i + 1);
  }
  return next;
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

const nvccEnv = msvcEnv({ ...process.env });
const nvcc = spawnSync(
  'nvcc',
  ['-ptx', '-O2', '-arch=compute_75', join(here, 'kernel', 'asic_pow.cu'), '-o', join(dist, 'asic_pow.ptx')],
  { cwd: here, stdio: 'inherit', env: nvccEnv },
);
if (nvcc.status === 0) {
  console.log(`asic_pow.ptx -> ${dist}`);
} else if (required) {
  fail(
    `nvcc PTX failed (status=${nvcc.status} signal=${nvcc.signal}${nvcc.error ? `; ${nvcc.error.message}` : ''}); CUDA grind needs asic_pow.ptx`,
  );
} else {
  console.error('nvcc PTX skipped (CUDA grind needs asic_pow.ptx; OpenCL still works)');
}

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
