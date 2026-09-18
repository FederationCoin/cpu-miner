import { describe, expect, it } from 'vitest';
import { envelopeAuthorization, mainFinderLive, payloadHashHex } from './registry';

describe('registry helpers', () => {
  it('hashes RFC 8785 JCS of the command', () => {
    const hash = payloadHashHex({
      commandKind: 'registerListing',
      connect: { kind: 'stratumOnly', stratum: { host: 'stratum.example.com', port: 23334 } },
      name: 'Example',
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      payloadHashHex({
        name: 'Example',
        connect: { kind: 'stratumOnly', stratum: { host: 'stratum.example.com', port: 23334 } },
        commandKind: 'registerListing',
      }),
    ).toBe(hash);
  });

  it('builds a Bearer envelope as base64url JSON', () => {
    const auth = envelopeAuthorization({ messageVersion: 1, commandKind: 'registerListing' });
    expect(auth.startsWith('Bearer ')).toBe(true);
    expect(auth).not.toMatch(/[+/=]/);
  });

  it('does not treat dummy MAIN as a live Finder tenant', () => {
    expect(mainFinderLive('testnet')).toBe(true);
    expect(mainFinderLive('main')).toBe(false);
  });
});
