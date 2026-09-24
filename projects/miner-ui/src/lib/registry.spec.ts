import { describe, expect, it } from 'vitest';
import {
  ConnectionKinds,
  ConnectionKindLabel,
  RegisterConnectionKinds,
  canAddPoolConnection,
  connectionEquals,
  envelopeAuthorization,
  listingCanMineThis,
  listingConnections,
  listingMineUrl,
  listingPrimeConnections,
  mainFinderLive,
  payloadHashHex,
  signedPayloadHash,
} from './registry';

describe('registry helpers', () => {
  it('hashes RFC 8785 JCS of the command', () => {
    const hash = payloadHashHex({
      commandKind: 'registerListing',
      connections: [{ kind: 'stratum', url: 'stratum.example.com:23334' }],
      name: 'Example',
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      payloadHashHex({
        name: 'Example',
        connections: [{ kind: 'stratum', url: 'stratum.example.com:23334' }],
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

  it('maps legacy connect and prefers connections', () => {
    const legacy = {
      connect: {
        kind: 'stratumAndDatum' as const,
        stratum: { host: 's.example.com', port: 23334 },
        datum: { host: 'd.example.com', port: 28916 },
        wss: { host: 'pool.example.com', path: '/stratum' },
      },
    };
    expect(listingConnections(legacy)).toEqual([
      { kind: 'stratum', url: 's.example.com:23334' },
      { kind: 'datumPrime', url: 'd.example.com:28916' },
      { kind: 'stratumWs', url: 'wss://pool.example.com/stratum' },
    ]);
    expect(
      listingConnections({
        connections: [{ kind: 'stratumWs', url: 'wss://a.example.com/stratum' }],
        connect: legacy.connect,
      }),
    ).toEqual([{ kind: 'stratumWs', url: 'wss://a.example.com/stratum' }]);
  });

  it('Mine this is first Stratum or Stratum WS; Prime is DATUM Prime Pool rows', () => {
    const tcp = { connections: [{ kind: 'stratum' as const, url: 's.example.com:23334' }] };
    const wss = {
      connections: [
        { kind: 'stratum' as const, url: 's.example.com:23334' },
        { kind: 'stratumWs' as const, url: 'wss://pool.example.com/stratum' },
        { kind: 'datumPrime' as const, url: 'd.example.com:28916' },
      ],
    };
    const prime = { connections: [{ kind: 'datumPrime' as const, url: 'd.example.com:28916' }] };
    expect(listingCanMineThis(tcp, false)).toBe(true);
    expect(listingCanMineThis(tcp, true)).toBe(false);
    expect(listingCanMineThis(wss, true)).toBe(true);
    expect(listingCanMineThis(prime, false)).toBe(false);
    expect(listingMineUrl(wss, true)).toBe('wss://pool.example.com/stratum');
    expect(listingMineUrl(tcp, false)).toBe('s.example.com:23334');
    expect(listingPrimeConnections(tcp)).toEqual([]);
    expect(listingPrimeConnections(wss)).toEqual([{ kind: 'datumPrime', url: 'd.example.com:28916' }]);
    expect(connectionEquals(wss.connections[1]!, { kind: 'stratumWs', url: 'WSS://pool.example.com/stratum' })).toBe(
      true,
    );
  });

  it('caps connections at 12 and 3 per kind', () => {
    const three = [
      { kind: 'stratum' as const, url: 'a.example.com:1' },
      { kind: 'stratum' as const, url: 'b.example.com:2' },
      { kind: 'stratum' as const, url: 'c.example.com:3' },
    ];
    expect(canAddPoolConnection(three, 'stratum')).toBe(false);
    expect(canAddPoolConnection(three, 'stratumWs')).toBe(true);
    const twelve = ConnectionKinds.flatMap((kind) =>
      [1, 2, 3].map((n) => ({ kind, url: `${kind}.example.com:${n}` })),
    );
    expect(twelve).toHaveLength(12);
    expect(canAddPoolConnection(twelve, 'stratum')).toBe(false);
    expect(canAddPoolConnection(twelve, 'stratumWs')).toBe(false);
  });

  it('does not offer DATUM Prime Pool WS on register Kind', () => {
    expect(RegisterConnectionKinds).toEqual(['stratum', 'stratumWs', 'datumPrime']);
    expect(ConnectionKinds).toContain('datumPrimeWs');
    expect(ConnectionKindLabel.datumPrime).toBe('DATUM Prime Pool');
  });
});
