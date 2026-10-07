import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED,
  MAX_ATTEMPTS,
  FetchExtrasError,
  assertAllowedRepo,
  assertSha256,
  backoffMs,
  defaultSleep,
  downloadHeaders,
  extraReady,
  fetchAssetBytes,
  fetchFollow,
  fetchOk,
  installKind,
  isGithubApiUrl,
  resolveMillArtifact,
  shouldRetryStatus,
  unzipTo,
  urlHost,
} from './fetch-extras-lib.mjs';

const SHA_OK = createHash('sha256').update('ok-zip').digest('hex');

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)),
  };
}

function binRes(status: number, bytes: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => ({}),
    arrayBuffer: async () => new TextEncoder().encode(bytes),
  };
}

function redirectRes(location?: string) {
  const headers = new Headers();
  if (location !== undefined) {
    headers.set('location', location);
  }
  return {
    ok: false,
    status: 302,
    headers,
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function filledPin(overrides: Record<string, unknown> = {}) {
  return {
    gitSha: 'cad03a8d8959fb4f7180fbcd13de3601a0fffd9f',
    tag: 'v29.5.0.federationcoin20261005.rc2',
    repo: 'FederationCoin/FederationCoin',
    assets: {
      'linux-x64': { name: 'federationcoind-linux-x64.zip', sha256: SHA_OK },
      'linux-arm64': { name: 'federationcoind-linux-arm64.zip', sha256: SHA_OK },
      'win-x64': { name: 'federationcoind-win-x64.zip', sha256: SHA_OK },
      'macos-arm64': { name: 'federationcoind-macos-arm64.zip', sha256: SHA_OK },
      'macos-x64': { name: 'federationcoind-macos-x64.zip', sha256: SHA_OK },
    },
    ...overrides,
  };
}

function releaseBody(asset: Record<string, unknown>) {
  return { assets: [asset] };
}

function metaThen(fetchImpl: (url: string, init?: { headers?: Record<string, string> }) => Promise<unknown>, asset: Record<string, unknown>, status = 200) {
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    if (url.includes('/releases/tags/')) {
      return status === 200 ? jsonRes(200, releaseBody(asset)) : jsonRes(status, {});
    }
    return fetchImpl(url, init);
  };
}

const sleep = async () => {};

describe('fetch-extras-lib', () => {
  it('maps mill artifacts and rejects an unknown MILL_ARTIFACT', () => {
    expect(resolveMillArtifact({ MILL_ARTIFACT: 'win-x64' }, 'linux', 'x64')).toBe('win-x64');
    expect(resolveMillArtifact({ MILL_ARTIFACT: '  ' }, 'win32', 'x64')).toBe('win-x64');
    expect(resolveMillArtifact({}, 'darwin', 'arm64')).toBe('macos-arm64');
    expect(resolveMillArtifact({}, 'darwin', 'x64')).toBe('macos-x64');
    expect(resolveMillArtifact({}, 'linux', 'arm64')).toBe('linux-arm64');
    expect(resolveMillArtifact({}, 'linux', 'x64')).toBe('linux-x64');
    expect(() => resolveMillArtifact({ MILL_ARTIFACT: 'solaris-x64' }, 'linux', 'x64')).toThrow(FetchExtrasError);
    expect(() => resolveMillArtifact({ MILL_ARTIFACT: 'solaris-x64' }, 'linux', 'x64')).toThrow(/unknown MILL_ARTIFACT solaris-x64/);
  });

  it('skips empty pins and refuses CONVOY or any repo outside ALLOWED', () => {
    expect(extraReady({ tag: '', gitSha: 'a', assets: { 'linux-x64': { name: 'n', sha256: SHA_OK } } }, 'linux-x64')).toBe(false);
    expect(extraReady(undefined, 'linux-x64')).toBe(false);
    expect(extraReady(filledPin(), 'linux-x64')).toBe(true);
    expect(ALLOWED.has('CONVOYMining/datum_gateway')).toBe(false);
    expect(() => assertAllowedRepo('gateway', 'CONVOYMining/datum_gateway')).toThrow(/gateway: repo not allowed/);
    expect(() => assertAllowedRepo('node', 'evil/x')).toThrow(/node: repo not allowed/);
    expect(() => assertAllowedRepo('node', undefined)).toThrow(/repo not allowed/);
    assertAllowedRepo('node', 'FederationCoin/FederationCoin');
    assertAllowedRepo('gateway', 'FederationCoin/datum_gateway');
  });

  it('sends Authorization only to api.github.com', () => {
    expect(isGithubApiUrl('https://api.github.com/repos/x/y')).toBe(true);
    expect(isGithubApiUrl('https://objects.githubusercontent.com/a')).toBe(false);
    expect(isGithubApiUrl('https://github.com/FederationCoin/FederationCoin/releases/download/t/f.zip')).toBe(false);
    expect(isGithubApiUrl('not a url')).toBe(false);
    expect(urlHost('https://api.github.com/x')).toBe('api.github.com');
    expect(urlHost('not a url')).toBe('invalid');
    expect(downloadHeaders('https://api.github.com/assets/1', 'secret', 'application/octet-stream').Authorization).toBe(
      'Bearer secret',
    );
    expect(downloadHeaders('https://objects.githubusercontent.com/a', 'secret', 'application/octet-stream').Authorization).toBeUndefined();
    expect(downloadHeaders('https://github.com/x/y/releases/download/t/f.zip', 'secret', 'application/octet-stream').Authorization).toBeUndefined();
    expect(downloadHeaders('https://api.github.com/assets/1', '', 'application/vnd.github+json').Authorization).toBeUndefined();
  });

  it('retries 5xx and 429 and does not retry 404', () => {
    expect(shouldRetryStatus(500)).toBe(true);
    expect(shouldRetryStatus(503)).toBe(true);
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(404)).toBe(false);
    expect(shouldRetryStatus(403)).toBe(false);
    expect(shouldRetryStatus(200)).toBe(false);
    expect(backoffMs(1)).toBe(200);
    expect(backoffMs(3)).toBe(600);
    expect(MAX_ATTEMPTS).toBe(4);
  });

  it('dies on release metadata HTTP 404 and 403', async () => {
    const pin = filledPin();
    await expect(
      fetchAssetBytes(pin, 'linux-x64', 'tok', {
        fetchImpl: async () => jsonRes(404, {}),
        sleep,
      }),
    ).rejects.toThrow(/FederationCoin\/FederationCoin v29.5.0.federationcoin20261005.rc2: release metadata HTTP 404/);
    await expect(
      fetchAssetBytes(pin, 'linux-x64', 'tok', {
        fetchImpl: async () => jsonRes(403, {}),
        sleep,
      }),
    ).rejects.toThrow(/release metadata HTTP 403/);
  });

  it('retries metadata HTTP 500 then succeeds', async () => {
    let n = 0;
    const pin = filledPin();
    const buf = await fetchAssetBytes(pin, 'linux-x64', 'tok', {
      fetchImpl: async (url: string) => {
        if (url.includes('/releases/tags/')) {
          n += 1;
          if (n === 1) {
            return jsonRes(500, {});
          }
          return jsonRes(200, releaseBody({
            name: 'federationcoind-linux-x64.zip',
            url: 'https://api.github.com/repos/FederationCoin/FederationCoin/releases/assets/1',
            browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
          }));
        }
        return binRes(200, 'ok-zip');
      },
      sleep,
    });
    expect(Buffer.from(buf).toString()).toBe('ok-zip');
    expect(n).toBe(2);
  });

  it('dies when the named asset is missing', async () => {
    const pin = filledPin();
    await expect(
      fetchAssetBytes(pin, 'linux-x64', 'tok', {
        fetchImpl: async () => jsonRes(200, { assets: [] }),
        sleep,
      }),
    ).rejects.toThrow(/no asset federationcoind-linux-x64.zip/);
    await expect(
      fetchAssetBytes(pin, 'linux-x64', 'tok', {
        fetchImpl: async () => jsonRes(200, {}),
        sleep,
      }),
    ).rejects.toThrow(/no asset federationcoind-linux-x64.zip/);
  });

  it('uses browser_download_url first without Authorization', async () => {
    const calls: { url: string; auth?: string }[] = [];
    const pin = filledPin();
    const buf = await fetchAssetBytes(pin, 'linux-x64', 'secret-token', {
      fetchImpl: async (url: string, init?: { headers?: Record<string, string> }) => {
        calls.push({ url, auth: init?.headers?.Authorization });
        if (url.includes('/releases/tags/')) {
          return jsonRes(200, releaseBody({
            name: 'federationcoind-linux-x64.zip',
            url: 'https://api.github.com/repos/FederationCoin/FederationCoin/releases/assets/1',
            browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
          }));
        }
        if (url.includes('/releases/download/')) {
          return binRes(200, 'ok-zip');
        }
        throw new Error(`unexpected ${url}`);
      },
      sleep,
    });
    expect(Buffer.from(buf).toString()).toBe('ok-zip');
    expect(calls.some((c) => c.url.includes('/releases/assets/'))).toBe(false);
    const browser = calls.find((c) => c.url.includes('/releases/download/'));
    expect(browser?.auth).toBeUndefined();
    const meta = calls.find((c) => c.url.includes('/releases/tags/'));
    expect(meta?.auth).toBe('Bearer secret-token');
  });

  it('retries download HTTP 500 then 200', async () => {
    let n = 0;
    const pin = filledPin();
    const buf = await fetchAssetBytes(pin, 'linux-x64', 'tok', {
      fetchImpl: metaThen(async () => {
        n += 1;
        if (n === 1) {
          return binRes(500, '');
        }
        return binRes(200, 'ok-zip');
      }, {
        name: 'federationcoind-linux-x64.zip',
        url: 'https://api.github.com/repos/FederationCoin/FederationCoin/releases/assets/1',
        browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
      }),
      sleep,
    });
    expect(Buffer.from(buf).toString()).toBe('ok-zip');
    expect(n).toBe(2);
  });

  it('retries HTTP 429 and a network error then succeeds', async () => {
    let n = 0;
    const pin = filledPin();
    const buf = await fetchAssetBytes(pin, 'linux-x64', 'tok', {
      fetchImpl: metaThen(async () => {
        n += 1;
        if (n === 1) {
          return binRes(429, '');
        }
        if (n === 2) {
          throw new TypeError('fetch failed');
        }
        return binRes(200, 'ok-zip');
      }, {
        name: 'federationcoind-linux-x64.zip',
        browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
      }),
      sleep,
    });
    expect(Buffer.from(buf).toString()).toBe('ok-zip');
    expect(n).toBe(3);
  });

  it('does not retry download HTTP 404 forever and falls back to the API url', async () => {
    const calls: string[] = [];
    const pin = filledPin();
    await expect(
      fetchAssetBytes(pin, 'linux-x64', 'tok', {
        fetchImpl: async (url: string) => {
          calls.push(url);
          if (url.includes('/releases/tags/')) {
            return jsonRes(200, releaseBody({
              name: 'federationcoind-linux-x64.zip',
              url: 'https://api.github.com/repos/FederationCoin/FederationCoin/releases/assets/1',
              browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
            }));
          }
          return binRes(404, '');
        },
        sleep,
      }),
    ).rejects.toThrow(/federationcoind-linux-x64.zip: download HTTP 404/);
    expect(calls.filter((u) => u.includes('/releases/download/')).length).toBe(1);
    expect(calls.filter((u) => u.includes('/releases/assets/')).length).toBe(1);
    expect(calls.length).toBeLessThan(8);
  });

  it('follows an API 302 to the CDN without forwarding the Bearer token', async () => {
    const calls: { url: string; auth?: string }[] = [];
    const pin = filledPin();
    const buf = await fetchAssetBytes(pin, 'linux-x64', 'secret-token', {
      fetchImpl: async (url: string, init?: { headers?: Record<string, string> }) => {
        calls.push({ url, auth: init?.headers?.Authorization });
        if (url.includes('/releases/tags/')) {
          return jsonRes(200, releaseBody({
            name: 'federationcoind-linux-x64.zip',
            url: 'https://api.github.com/repos/FederationCoin/FederationCoin/releases/assets/1',
          }));
        }
        if (url.includes('/releases/assets/1')) {
          return redirectRes('https://objects.githubusercontent.com/release-assets/1');
        }
        if (url.includes('objects.githubusercontent.com')) {
          return binRes(200, 'ok-zip');
        }
        throw new Error(`unexpected ${url}`);
      },
      sleep,
    });
    expect(Buffer.from(buf).toString()).toBe('ok-zip');
    expect(calls.find((c) => c.url.includes('/releases/assets/1'))?.auth).toBe('Bearer secret-token');
    expect(calls.find((c) => c.url.includes('objects.githubusercontent.com'))?.auth).toBeUndefined();
  });

  it('follows a relative redirect and dies when Location is missing or hops exceed the cap', async () => {
    const rel = await fetchFollow('https://api.github.com/repos/x/y/releases/assets/1', {
      token: 'tok',
      accept: 'application/octet-stream',
      fetchImpl: async (url: string) => {
        if (url.endsWith('/assets/1')) {
          return { ...redirectRes('/release-assets/9'), status: 307 };
        }
        return binRes(200, 'ok-zip');
      },
    });
    expect(rel.ok).toBe(true);
    await expect(
      fetchFollow('https://api.github.com/assets/1', {
        token: '',
        accept: 'application/octet-stream',
        fetchImpl: async () => redirectRes(),
      }),
    ).rejects.toThrow(/redirect missing location from api.github.com/);
    await expect(
      fetchFollow('https://api.github.com/assets/1', {
        token: '',
        accept: 'application/octet-stream',
        maxRedirects: 2,
        fetchImpl: async () => redirectRes('https://api.github.com/assets/2'),
      }),
    ).rejects.toThrow(/too many redirects/);
  });

  it('falls back from a failed browser download to the API asset url', async () => {
    const calls: string[] = [];
    const pin = filledPin();
    const buf = await fetchAssetBytes(pin, 'linux-x64', 'tok', {
      fetchImpl: async (url: string) => {
        calls.push(url);
        if (url.includes('/releases/tags/')) {
          return jsonRes(200, releaseBody({
            name: 'federationcoind-linux-x64.zip',
            url: 'https://api.github.com/repos/FederationCoin/FederationCoin/releases/assets/1',
            browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
          }));
        }
        if (url.includes('/releases/download/')) {
          return binRes(404, '');
        }
        return binRes(200, 'ok-zip');
      },
      sleep,
    });
    expect(Buffer.from(buf).toString()).toBe('ok-zip');
    expect(calls.some((u) => u.includes('/releases/assets/1'))).toBe(true);
  });

  it('rethrows a non-FetchExtrasError from the browser body read', async () => {
    const pin = filledPin();
    await expect(
      fetchAssetBytes(pin, 'linux-x64', 'tok', {
        fetchImpl: metaThen(async () => {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({}),
            arrayBuffer: async () => {
              throw new TypeError('truncated body');
            },
          };
        }, {
          name: 'federationcoind-linux-x64.zip',
          url: 'https://api.github.com/repos/FederationCoin/FederationCoin/releases/assets/1',
          browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
        }),
        sleep,
      }),
    ).rejects.toThrow(/truncated body/);
  });

  it('dies when a browser-only asset cannot be downloaded', async () => {
    const pin = filledPin();
    await expect(
      fetchAssetBytes(pin, 'linux-x64', 'tok', {
        fetchImpl: metaThen(async () => binRes(404, ''), {
          name: 'federationcoind-linux-x64.zip',
          browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
        }),
        sleep,
      }),
    ).rejects.toThrow(/download HTTP 404/);
  });

  it('dies after the last 5xx attempt and on a last-attempt network error', async () => {
    const pin = filledPin();
    await expect(
      fetchAssetBytes(pin, 'linux-x64', 'tok', {
        fetchImpl: metaThen(async () => binRes(500, ''), {
          name: 'federationcoind-linux-x64.zip',
          browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
        }),
        sleep,
      }),
    ).rejects.toThrow(/download HTTP 500/);
    await expect(
      fetchOk('https://example.com/x', {
        token: '',
        accept: '*/*',
        describeFail: (s) => `probe HTTP ${s}`,
        fetchImpl: async () => {
          throw new TypeError('fetch failed');
        },
        sleep,
        maxAttempts: 2,
      }),
    ).rejects.toThrow(/probe HTTP network/);
  });

  it('dies on sha256 mismatch and on a zip that is missing the daemon exe', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fc-extras-sha-'));
    const pin = filledPin({
      assets: {
        ...filledPin().assets,
        'linux-x64': { name: 'federationcoind-linux-x64.zip', sha256: 'ab'.repeat(32) },
      },
    });
    const fetchImpl = metaThen(async () => binRes(200, 'ok-zip'), {
      name: 'federationcoind-linux-x64.zip',
      browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
    });
    await expect(
      installKind({
        kind: 'node',
        pin,
        artifact: 'linux-x64',
        token: 'tok',
        root,
        dirName: 'federationcoind',
        exeBase: 'federationcoind',
        fetchImpl,
        sleep,
        unzip: () => {},
      }),
    ).rejects.toThrow(/node: sha256 mismatch/);
    expect(() => assertSha256('node', Buffer.from('ok-zip'), 'ab'.repeat(32))).toThrow(/sha256 mismatch/);
    assertSha256('node', Buffer.from('ok-zip'), SHA_OK);
    await expect(
      installKind({
        kind: 'node',
        pin: filledPin(),
        artifact: 'linux-x64',
        token: 'tok',
        root,
        dirName: 'federationcoind',
        exeBase: 'federationcoind',
        fetchImpl,
        sleep,
        unzip: () => {},
      }),
    ).rejects.toThrow(/node: zip missing federationcoind/);
  });

  it('installs a filled pin and skips an empty one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fc-extras-ok-'));
    const fetchImpl = metaThen(async () => binRes(200, 'ok-zip'), {
      name: 'federationcoind-linux-x64.zip',
      browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-linux-x64.zip',
    });
    const ok = await installKind({
      kind: 'node',
      pin: filledPin(),
      artifact: 'linux-x64',
      token: 'tok',
      root,
      dirName: 'federationcoind',
      exeBase: 'federationcoind',
      fetchImpl,
      sleep,
      unzip: (_zip, dest) => {
        writeFileSync(join(dest, 'federationcoind'), 'x');
      },
    });
    expect(ok).toEqual({ skipped: false });
    const skipped = await installKind({
      kind: 'node',
      pin: filledPin({ tag: '' }),
      artifact: 'linux-x64',
      token: '',
      root,
      dirName: 'federationcoind',
      exeBase: 'federationcoind',
    });
    expect(skipped).toEqual({ skipped: true });
    const winRoot = mkdtempSync(join(tmpdir(), 'fc-extras-win-'));
    const win = await installKind({
      kind: 'node',
      pin: filledPin(),
      artifact: 'win-x64',
      token: 'tok',
      root: winRoot,
      dirName: 'federationcoind',
      exeBase: 'federationcoind',
      fetchImpl: metaThen(async () => binRes(200, 'ok-zip'), {
        name: 'federationcoind-win-x64.zip',
        browser_download_url: 'https://github.com/FederationCoin/FederationCoin/releases/download/t/federationcoind-win-x64.zip',
      }),
      sleep,
      unzip: (_zip, dest) => {
        writeFileSync(join(dest, 'federationcoind.exe'), 'w');
      },
    });
    expect(win).toEqual({ skipped: false });
  });

  it('refuses CONVOY on install before any download', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fc-extras-convoy-'));
    let fetched = 0;
    await expect(
      installKind({
        kind: 'gateway',
        pin: filledPin({ repo: 'CONVOYMining/datum_gateway' }),
        artifact: 'linux-x64',
        token: 'tok',
        root,
        dirName: 'datum_gateway',
        exeBase: 'datum_gateway',
        fetchImpl: async () => {
          fetched += 1;
          return jsonRes(200, {});
        },
        sleep,
      }),
    ).rejects.toThrow(/gateway: repo not allowed/);
    expect(fetched).toBe(0);
  });

  it('unzips with tar on Windows and python3 elsewhere, and dies when the spawn fails', () => {
    const dest = mkdtempSync(join(tmpdir(), 'fc-unzip-'));
    const zip = join(dest, 'a.zip');
    writeFileSync(zip, 'z');
    unzipTo(zip, join(dest, 'out-posix'), { platform: 'linux', spawn: () => ({ status: 0 }) });
    unzipTo(zip, join(dest, 'out-win'), { platform: 'win32', spawn: () => ({ status: 0 }) });
    expect(() => unzipTo(zip, join(dest, 'bad-posix'), { platform: 'linux', spawn: () => ({ status: 1 }) })).toThrow(
      /python3 unzip failed/,
    );
    expect(() => unzipTo(zip, join(dest, 'bad-win'), { platform: 'win32', spawn: () => ({ status: 1 }) })).toThrow(/tar -xf failed/);
    mkdirSync(join(dest, 'default'), { recursive: true });
    unzipTo(zip, join(dest, 'default'), { spawn: () => ({ status: 0 }) });
  });

  it('retries a thrown FetchExtrasError that names HTTP 500', async () => {
    let n = 0;
    const res = await fetchOk('https://api.github.com/x', {
      token: '',
      accept: '*/*',
      describeFail: (s) => `x HTTP ${s}`,
      fetchImpl: async () => {
        n += 1;
        if (n === 1) {
          throw new FetchExtrasError('x HTTP 500');
        }
        return binRes(200, 'ok');
      },
      sleep,
    });
    expect(res.ok).toBe(true);
    expect(n).toBe(2);
  });

  it('sleeps zero milliseconds and fetches without a via label', async () => {
    await defaultSleep(0);
    const res = await fetchOk('https://example.com/x', {
      token: '',
      accept: '*/*',
      describeFail: (s) => `x HTTP ${s}`,
      fetchImpl: async () => binRes(200, 'ok-zip'),
      sleep,
    });
    expect(res.ok).toBe(true);
  });
});
