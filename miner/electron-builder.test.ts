import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('electron-builder package.json', () => {
  it('keeps portable options at the root so 26.15 schema accepts win', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const build = pkg.build;
    expect(build.win.portable).toBeUndefined();
    expect(build.win.target).toEqual(['portable', 'zip']);
    expect(build.portable.splashImage).toBe('build/splash.bmp');
    expect(build.portable.unpackDirName).toBe('FederationCoinCPUMiner');
    expect(build.portable.artifactName).toBe('federationcoin-cpu-miner-${version}-${os}-${arch}.${ext}');
  });
});
