import { describe, expect, it } from 'vitest';
import { advertisedAttestKinds, attestConnectFromListing, envelopeAuthorization, mainFinderLive, payloadHashHex, signedPayloadHash } from './registry';

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

  it('binds signing height and hash into the payload hash', () => {
    const command = { commandKind: 'registerListing', name: 'Example' };
    const hash = 'ab'.repeat(32);
    expect(signedPayloadHash(command, 1, hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(signedPayloadHash(command, 1, hash)).not.toBe(signedPayloadHash(command, 2, hash));
    expect(signedPayloadHash(command, 1, hash)).not.toBe(payloadHashHex(command));
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

  it('shows only advertised AttestConnect kinds', () => {
    expect(advertisedAttestKinds({ kind: 'stratumOnly', stratum: { host: 's.example.com', port: 23334 } })).toEqual([
      'stratum',
    ]);
    expect(advertisedAttestKinds({ kind: 'datumOnly', datum: { host: 'd.example.com', port: 28916 } })).toEqual(['datum']);
    expect(
      advertisedAttestKinds({
        kind: 'stratumAndDatum',
        stratum: { host: 's.example.com', port: 23334 },
        datum: { host: 'd.example.com', port: 28916 },
      }),
    ).toEqual(['stratum', 'datum']);
    expect(
      attestConnectFromListing({ kind: 'stratumOnly', stratum: { host: 's.example.com', port: 23334 } }, 'datum'),
    ).toBeUndefined();
    expect(
      attestConnectFromListing({ kind: 'stratumOnly', stratum: { host: 's.example.com', port: 23334 } }, 'stratum'),
    ).toEqual({ kind: 'stratum', host: 's.example.com', port: 23334 });
  });
});
