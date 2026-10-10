#!/usr/bin/env node
// Fetch pinned node/gateway daemon zips into vendor/. Empty tag or sha256 skips.
// Never CONVOY. Never MAIN. Do not print tokens.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installKind, resolveMillArtifact } from './fetch-extras-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function die(err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
}

let pins;
try {
  pins = JSON.parse(readFileSync(join(root, 'extras-checksums.json'), 'utf8'));
} catch {
  console.log('fetch-extras: no extras-checksums.json, skip');
  process.exit(0);
}

let artifact;
try {
  artifact = resolveMillArtifact(process.env, process.platform, process.arch);
} catch (e) {
  die(e);
}

const token = process.env.GITHUB_TOKEN || '';

try {
  await installKind({
    kind: 'node',
    pin: pins.node,
    artifact,
    token,
    root,
    dirName: 'federationcoind',
    exeBase: 'federationcoind',
  });
  await installKind({
    kind: 'gateway',
    pin: pins.gateway,
    artifact,
    token,
    root,
    dirName: 'datum_gateway',
    exeBase: 'datum_gateway',
  });
} catch (e) {
  die(e);
}
