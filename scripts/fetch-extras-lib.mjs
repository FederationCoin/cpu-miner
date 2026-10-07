// Download helpers for fetch-extras. Never CONVOY. Never MAIN. Do not print tokens.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const MILL = ['linux-x64', 'linux-arm64', 'win-x64', 'macos-arm64', 'macos-x64'];
export const ALLOWED = new Set(['FederationCoin/FederationCoin', 'FederationCoin/datum_gateway']);
export const USER_AGENT = 'federationcoin-cpu-miner-fetch-extras';
export const MAX_ATTEMPTS = 4;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

export class FetchExtrasError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FetchExtrasError';
  }
}

export function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function backoffMs(attempt) {
  return 200 * attempt;
}

export function urlHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid';
  }
}

export function isGithubApiUrl(url) {
  try {
    return new URL(url).hostname === 'api.github.com';
  } catch {
    return false;
  }
}

export function shouldRetryStatus(status) {
  return status === 429 || status >= 500;
}

export function extraReady(pin, artifact) {
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

export function resolveMillArtifact(env, platform, arch) {
  if (env.MILL_ARTIFACT?.trim()) {
    const a = env.MILL_ARTIFACT.trim();
    if (!MILL.includes(a)) {
      throw new FetchExtrasError(`unknown MILL_ARTIFACT ${a}`);
    }
    return a;
  }
  if (platform === 'win32') {
    return 'win-x64';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  }
  return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

export function assertAllowedRepo(kind, repo) {
  if (!ALLOWED.has(String(repo ?? ''))) {
    throw new FetchExtrasError(`${kind}: repo not allowed`);
  }
}

export function assertSha256(kind, buf, expect) {
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== expect) {
    throw new FetchExtrasError(`${kind}: sha256 mismatch`);
  }
}

export function downloadHeaders(url, token, accept) {
  const headers = {
    Accept: accept,
    'User-Agent': USER_AGENT,
  };
  if (token && isGithubApiUrl(url)) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function statusFromError(err) {
  const m = err instanceof Error ? err.message.match(/HTTP (\d+)/) : null;
  return m ? Number(m[1]) : 0;
}

export async function fetchFollow(url, { token, accept, fetchImpl, maxRedirects = 10 }) {
  let current = url;
  for (let hop = 0; hop < maxRedirects; hop++) {
    const res = await fetchImpl(current, {
      headers: downloadHeaders(current, token, accept),
      redirect: 'manual',
    });
    if (REDIRECT.has(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) {
        throw new FetchExtrasError(`redirect missing location from ${urlHost(current)}`);
      }
      current = new URL(loc, current).href;
      continue;
    }
    return res;
  }
  throw new FetchExtrasError('too many redirects');
}

export async function fetchOk(url, opts) {
  const {
    token,
    accept,
    describeFail,
    fetchImpl,
    sleep,
    maxAttempts = MAX_ATTEMPTS,
    via,
    label,
  } = opts;
  const host = urlHost(url);
  let last = new FetchExtrasError(describeFail('failed'));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (label && via) {
      console.log(`fetch-extras: ${label} ${via} ${host} attempt ${attempt}/${maxAttempts}`);
    }
    try {
      const res = await fetchFollow(url, { token, accept, fetchImpl });
      if (res.ok) {
        return res;
      }
      last = new FetchExtrasError(describeFail(res.status));
      if (!shouldRetryStatus(res.status)) {
        throw last;
      }
    } catch (e) {
      if (e instanceof FetchExtrasError && !shouldRetryStatus(statusFromError(e))) {
        throw e;
      }
      last = e instanceof FetchExtrasError ? e : new FetchExtrasError(describeFail('network'));
    }
    if (attempt === maxAttempts) {
      throw last;
    }
    await sleep(backoffMs(attempt));
  }
}

export async function fetchAssetBytes(pin, artifact, token, { fetchImpl, sleep }) {
  const name = pin.assets[artifact].name.trim();
  const [owner, repo] = pin.repo.split('/');
  const tag = pin.tag.trim();
  const api = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const meta = await fetchOk(api, {
    token,
    accept: 'application/vnd.github+json',
    describeFail: (status) => `${pin.repo} ${tag}: release metadata HTTP ${status}`,
    fetchImpl,
    sleep,
    via: 'api',
    label: `${pin.repo} ${tag}`,
  });
  const body = await meta.json();
  const asset = (body.assets || []).find((x) => x.name === name);
  if (!asset || (!asset.url && !asset.browser_download_url)) {
    throw new FetchExtrasError(`${pin.repo} ${tag}: no asset ${name}`);
  }
  if (asset.browser_download_url) {
    try {
      const res = await fetchOk(asset.browser_download_url, {
        token: '',
        accept: 'application/octet-stream',
        describeFail: (status) => `${name}: download HTTP ${status}`,
        fetchImpl,
        sleep,
        via: 'browser',
        label: name,
      });
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (!(e instanceof FetchExtrasError) || !asset.url) {
        throw e;
      }
    }
  }
  const res = await fetchOk(asset.url, {
    token,
    accept: 'application/octet-stream',
    describeFail: (status) => `${name}: download HTTP ${status}`,
    fetchImpl,
    sleep,
    via: 'api',
    label: name,
  });
  return Buffer.from(await res.arrayBuffer());
}

export function unzipTo(zipPath, destDir, { platform = process.platform, spawn = spawnSync } = {}) {
  mkdirSync(destDir, { recursive: true });
  if (platform === 'win32') {
    const r = spawn('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
    if (r.status !== 0) {
      throw new FetchExtrasError('tar -xf failed');
    }
    return;
  }
  const r = spawn(
    'python3',
    ['-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, destDir],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    throw new FetchExtrasError('python3 unzip failed');
  }
}

export async function installKind({
  kind,
  pin,
  artifact,
  token,
  root,
  dirName,
  exeBase,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  unzip = unzipTo,
}) {
  if (!extraReady(pin, artifact)) {
    console.log(`fetch-extras: skip ${kind} (empty tag or sha256)`);
    return { skipped: true };
  }
  assertAllowedRepo(kind, pin.repo);
  const expect = pin.assets[artifact].sha256.trim().toLowerCase();
  const buf = await fetchAssetBytes(pin, artifact, token, { fetchImpl, sleep });
  assertSha256(kind, buf, expect);
  const tmp = join(root, 'vendor', `.${dirName}-dl.zip`);
  const dest = join(root, 'vendor', dirName);
  mkdirSync(join(root, 'vendor'), { recursive: true });
  mkdirSync(dest, { recursive: true });
  writeFileSync(tmp, buf);
  try {
    unzip(tmp, dest);
  } finally {
    rmSync(tmp, { force: true });
  }
  const exe = artifact === 'win-x64' ? `${exeBase}.exe` : exeBase;
  if (!existsSync(join(dest, exe))) {
    throw new FetchExtrasError(`${kind}: zip missing ${exe}`);
  }
  console.log(`fetch-extras: ${kind} ${artifact} ok`);
  return { skipped: false };
}
