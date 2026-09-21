import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function millArtifact(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') {
    return 'win-x64';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  }
  return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

function ensureVendor(dirName, readme) {
  const dest = join(root, 'vendor', dirName);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'README.md'), readme);
  return dest;
}

function copyPinned(name, destDir, candidates, expected) {
  const pin = String(expected ?? '')
    .trim()
    .toLowerCase();
  if (!pin) {
    return;
  }
  for (const src of candidates) {
    if (!existsSync(src)) {
      continue;
    }
    const got = sha256File(src);
    if (got !== pin) {
      console.warn(`${name}: checksum mismatch at ${basename(src)}, skip`);
      continue;
    }
    cpSync(src, join(destDir, basename(src)));
    return;
  }
}

function pinSha(manifest, kind) {
  const art = millArtifact();
  return String(manifest?.[kind]?.assets?.[art]?.sha256 ?? '')
    .trim()
    .toLowerCase();
}

let pins = {};
try {
  pins = JSON.parse(readFileSync(join(root, 'extras-checksums.json'), 'utf8'));
} catch {
  /* optional extras stay empty */
}

const nodeDest = ensureVendor(
  'federationcoind',
  'Optional federationcoind extra. Filled from extras-checksums.json (git SHA plus per-OS SHA-256). Never a MAIN binary.\n',
);
const gwDest = ensureVendor(
  'datum_gateway',
  'Optional datum_gateway extra. Filled from extras-checksums.json (git SHA plus per-OS SHA-256). Do not copy CONVOY binaries.\n',
);

copyPinned(
  'federationcoind',
  nodeDest,
  [
    join(root, '../FederationCoin/build/bin/federationcoind'),
    join(root, '../FederationCoin/src/federationcoind'),
    join(root, '../FederationCoin/build/bin/federationcoind.exe'),
  ],
  pinSha(pins, 'node'),
);

copyPinned(
  'datum_gateway',
  gwDest,
  [
    join(root, '../datum_gateway/datum_gateway'),
    join(root, '../datum_gateway/build/datum_gateway'),
    join(root, '../datum_gateway/build/datum_gateway.exe'),
  ],
  pinSha(pins, 'gateway'),
);
