import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AddonPresence = { kind: 'present'; path: string } | { kind: 'missing' };

export type ExtrasProbe = {
  node: boolean;
  gateway: boolean;
  pool: boolean;
};

export function addonExeName(base: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${base}.exe` : base;
}

export function resolveAddon(
  envKey: string,
  dirName: string,
  exeBase: string,
  env: NodeJS.ProcessEnv,
  here: string,
  resourcesPath: string,
  platform: NodeJS.Platform,
): AddonPresence {
  const fromEnv = env[envKey]?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return { kind: 'present', path: fromEnv };
  }
  const exe = addonExeName(exeBase, platform);
  const packaged = join(resourcesPath, dirName, exe);
  if (existsSync(packaged)) {
    return { kind: 'present', path: packaged };
  }
  const vendor = join(here, '../vendor', dirName, exe);
  if (existsSync(vendor)) {
    return { kind: 'present', path: vendor };
  }
  const sibling = join(here, '../..', dirName, exe);
  if (existsSync(sibling)) {
    return { kind: 'present', path: sibling };
  }
  return { kind: 'missing' };
}

export function resolveNodeBin(env: NodeJS.ProcessEnv, here: string, resourcesPath: string, platform: NodeJS.Platform = process.platform): AddonPresence {
  return resolveAddon('FEDERATIONCOIND_BIN', 'federationcoind', 'federationcoind', env, here, resourcesPath, platform);
}

export function resolveGatewayBin(env: NodeJS.ProcessEnv, here: string, resourcesPath: string, platform: NodeJS.Platform = process.platform): AddonPresence {
  return resolveAddon('DATUM_GATEWAY_BIN', 'datum_gateway', 'datum_gateway', env, here, resourcesPath, platform);
}

export function probeExtras(
  env: NodeJS.ProcessEnv,
  here: string,
  resourcesPath: string,
  platform: NodeJS.Platform,
  resolvePool: () => string | null,
): ExtrasProbe {
  return {
    node: resolveNodeBin(env, here, resourcesPath, platform).kind === 'present',
    gateway: resolveGatewayBin(env, here, resourcesPath, platform).kind === 'present',
    pool: !!resolvePool(),
  };
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function extraChecksumOk(path: string, expected: string): boolean {
  const pin = expected.trim().toLowerCase();
  if (!pin || !existsSync(path)) {
    return false;
  }
  return sha256File(path) === pin;
}
