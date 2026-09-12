import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ResEdit from 'resedit';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const zipName = `federationcoin-cpu-miner-${version}-win-x64.zip`;
const cacheZip = join(
  homedir(),
  '.cache/electron/f9c7436ab4a2c1ed6ac6cea2902187de75bd5b7a60c0973ad8967c318a6313c3/electron-v44.3.0-win32-x64.zip',
);
const outDir = join(root, 'dist-electron');
const stage = join(outDir, 'win-stage');
const unpacked = join(outDir, 'win-unpacked');
const png = join(root, 'build/icon.png');
const ico = join(outDir, 'icon.ico');
const zipPath = join(outDir, zipName);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
  }
}

function stampIcon(exePath, icoPath) {
  const exe = ResEdit.NtExecutable.from(readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(readFileSync(icoPath));
  const icons = iconFile.icons.map((item) => item.data);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (groups.length === 0) {
    throw new Error(`${exePath} has no icon group`);
  }
  for (const g of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons);
  }
  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vis[0]) {
    vis[0].setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        FileDescription: 'FederationCoin CPU Miner',
        ProductName: 'FederationCoin CPU Miner',
        InternalName: 'federationcoin-cpu-miner',
        OriginalFilename: 'federationcoin-cpu-miner.exe',
        CompanyName: 'FederationCoin',
      },
    );
    vis[0].outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
}

if (!existsSync(join(root, 'out-electron/main.js'))) {
  throw new Error('run npm run build:app first');
}
if (!existsSync(cacheZip)) {
  throw new Error(`missing ${cacheZip}`);
}

mkdirSync(outDir, { recursive: true });
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
run('unzip', ['-q', cacheZip, '-d', stage]);
run('convert', [
  png,
  '-background',
  'none',
  '-define',
  'icon:auto-resize=256,128,64,48,32,16',
  ico,
]);

const electronExe = join(stage, 'electron.exe');
stampIcon(electronExe, ico);
renameSync(electronExe, join(stage, 'federationcoin-cpu-miner.exe'));
rmSync(join(stage, 'resources/default_app.asar'), { force: true });

const app = join(stage, 'resources/app');
mkdirSync(join(app, 'dist'), { recursive: true });
mkdirSync(join(app, 'node_modules'), { recursive: true });
mkdirSync(join(stage, 'resources/gpu-hasher'), { recursive: true });
copyFileSync(join(root, 'package.json'), join(app, 'package.json'));
cpSync(join(root, 'out-electron'), join(app, 'out-electron'), { recursive: true });
cpSync(join(root, 'dist/renderer'), join(app, 'dist/renderer'), { recursive: true });
cpSync(join(root, 'node_modules/@noble'), join(app, 'node_modules/@noble'), { recursive: true });
copyFileSync(join(root, 'build/icon.png'), join(app, 'icon.png'));
copyFileSync(join(root, 'native/gpu-hasher/kernel/asic_pow.cl'), join(stage, 'resources/gpu-hasher/asic_pow.cl'));

let zipDir = stage;
try {
  rmSync(unpacked, { recursive: true, force: true });
  renameSync(stage, unpacked);
  zipDir = unpacked;
} catch (err) {
  console.warn(`close the running miner to replace win-unpacked: ${err.message}`);
}

rmSync(zipPath, { force: true });
run('zip', ['-r', '-q', zipName, basename(zipDir)], { cwd: outDir });

const downloads = '/mnt/c/Users/oxnar/Downloads';
if (existsSync(downloads)) {
  copyFileSync(zipPath, join(downloads, zipName));
  console.log(join(downloads, zipName));
}
console.log(zipPath);
