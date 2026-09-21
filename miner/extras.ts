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

export const MILL_ARTIFACTS = ['linux-x64', 'linux-arm64', 'win-x64', 'macos-arm64', 'macos-x64'] as const;

export type MillArtifact = (typeof MILL_ARTIFACTS)[number];

export type ExtraAssetPin = { name: string; sha256: string };

export type ExtraPin = {
  gitSha: string;
  tag: string;
  repo: string;
  assets: Record<MillArtifact, ExtraAssetPin>;
};

export type ExtrasManifest = { node: ExtraPin; gateway: ExtraPin };

const NODE_REPO = 'FederationCoin/FederationCoin';
const GATEWAY_REPO = 'FederationCoin/datum_gateway';

export function millArtifact(platform: NodeJS.Platform = process.platform, arch: string = process.arch): MillArtifact {
  if (platform === 'win32') {
    return 'win-x64';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  }
  return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

function isAssetPin(v: unknown): v is ExtraAssetPin {
  if (!v || typeof v !== 'object') {
    return false;
  }
  const a = v as ExtraAssetPin;
  return typeof a.name === 'string' && typeof a.sha256 === 'string';
}

function isExtraPin(v: unknown): v is ExtraPin {
  if (!v || typeof v !== 'object') {
    return false;
  }
  const p = v as ExtraPin;
  if (typeof p.gitSha !== 'string' || typeof p.tag !== 'string' || typeof p.repo !== 'string') {
    return false;
  }
  if (!p.assets || typeof p.assets !== 'object') {
    return false;
  }
  return MILL_ARTIFACTS.every((k) => isAssetPin(p.assets[k]));
}

export function parseExtrasManifest(raw: unknown): ExtrasManifest | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as ExtrasManifest;
  if (!isExtraPin(o.node) || !isExtraPin(o.gateway)) {
    return null;
  }
  if (o.node.repo !== NODE_REPO || o.gateway.repo !== GATEWAY_REPO) {
    return null;
  }
  return o;
}

export function extraFetchReady(pin: ExtraPin, artifact: MillArtifact): boolean {
  const a = pin.assets[artifact];
  const sha = a.sha256.trim().toLowerCase();
  return (
    pin.tag.trim().length > 0 &&
    pin.gitSha.trim().length > 0 &&
    a.name.trim().length > 0 &&
    /^[0-9a-f]{64}$/.test(sha)
  );
}

export function extraPinSha(pin: ExtraPin | undefined, artifact: MillArtifact): string {
  return pin?.assets[artifact]?.sha256.trim().toLowerCase() ?? '';
}
