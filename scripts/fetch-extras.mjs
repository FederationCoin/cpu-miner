#!/usr/bin/env node
// Fetch pinned node/gateway daemon zips into vendor/. Empty tag or sha256 skips.
// Never CONVOY. Never MAIN. Do not print tokens.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MILL = ['linux-x64', 'linux-arm64', 'win-x64', 'macos-arm64', 'macos-x64'];
const ALLOWED = new Set(['FederationCoin/FederationCoin', 'FederationCoin/datum_gateway']);

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function millArtifact() {
  if (process.env.MILL_ARTIFACT?.trim()) {
    const a = process.env.MILL_ARTIFACT.trim();
    if (!MILL.includes(a)) {
      die(`unknown MILL_ARTIFACT ${a}`);
    }
    return a;
  }
  if (process.platform === 'win32') {
    return 'win-x64';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  }
  return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

function ready(pin, artifact) {
  const a = pin?.assets?.[artifact];
  const sha = String(a?.sha256 ?? '')
    .trim()
    .toLowerCase();
  return Boolean(
    String(pin?.tag ?? '').trim() &&
      String(pin?.gitSha ?? '').trim() &&
      String(a?.name ?? '').trim() &&
      /^[0-9a-f]{64}$/.test(sha),
  );
}

async function fetchAsset(pin, artifact, token) {
  const name = pin.assets[artifact].name.trim();
  const [owner, repo] = pin.repo.split('/');
  const tag = pin.tag.trim();
  const api = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'federationcoin-cpu-miner-fetch-extras',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const meta = await fetch(api, { headers });
  if (!meta.ok) {
    die(`${pin.repo} ${tag}: release metadata HTTP ${meta.status}`);
  }
  const body = await meta.json();
  const asset = (body.assets || []).find((x) => x.name === name);
  if (!asset?.url) {
    die(`${pin.repo} ${tag}: no asset ${name}`);
  }
  const res = await fetch(asset.url, {
    headers: { ...headers, Accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  if (!res.ok) {
    die(`${name}: download HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function unzipTo(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const r = spawnSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
  if (r.status !== 0) {
    die('tar -xf failed');
  }
}

let pins;
try {
  pins = JSON.parse(readFileSync(join(root, 'extras-checksums.json'), 'utf8'));
} catch {
  console.log('fetch-extras: no extras-checksums.json, skip');
  process.exit(0);
}

const artifact = millArtifact();
const token = process.env.GITHUB_TOKEN || '';

async function one(kind, dirName, exeBase) {
  const pin = pins[kind];
  if (!ready(pin, artifact)) {
    console.log(`fetch-extras: skip ${kind} (empty tag or sha256)`);
    return;
  }
  if (!ALLOWED.has(String(pin.repo ?? ''))) {
    die(`${kind}: repo not allowed`);
  }
  const expect = pin.assets[artifact].sha256.trim().toLowerCase();
  const buf = await fetchAsset(pin, artifact, token);
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== expect) {
    die(`${kind}: sha256 mismatch`);
  }
  const tmp = join(root, 'vendor', `.${dirName}-dl.zip`);
  const dest = join(root, 'vendor', dirName);
  mkdirSync(dest, { recursive: true });
  writeFileSync(tmp, buf);
  unzipTo(tmp, dest);
  rmSync(tmp, { force: true });
  const exe = artifact === 'win-x64' ? `${exeBase}.exe` : exeBase;
  if (!existsSync(join(dest, exe))) {
    die(`${kind}: zip missing ${exe}`);
  }
  console.log(`fetch-extras: ${kind} ${artifact} ok`);
}

await one('node', 'federationcoind', 'federationcoind');
await one('gateway', 'datum_gateway', 'datum_gateway');
