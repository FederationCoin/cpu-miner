import { describe, expect, it } from 'vitest';
import { connectHostForReach, listenBindAddr, parseListenReach, privateIpv4 } from './listen-reach.js';

describe('listen reach', () => {
  it('maps this computer and this network to bind addresses', () => {
    expect(parseListenReach('network')).toBe('network');
    expect(parseListenReach('computer')).toBe('computer');
    expect(parseListenReach('public')).toBe('computer');
    expect(listenBindAddr('computer')).toBe('127.0.0.1');
    expect(listenBindAddr('network')).toBe('0.0.0.0');
  });

  it('copies a private LAN address for this network and loopback for this computer', () => {
    const ifaces = {
      lo: [{ address: '127.0.0.1', family: 'IPv4' as const, internal: true }],
      eth0: [
        { address: '8.8.8.8', family: 'IPv4' as const, internal: false },
        { address: '192.168.1.20', family: 'IPv4' as const, internal: false },
        { address: '172.15.0.1', family: 'IPv4' as const, internal: false },
        { address: '172.16.0.4', family: 'IPv4' as const, internal: false },
      ],
    };
    expect(privateIpv4(ifaces)).toEqual(['192.168.1.20', '172.16.0.4']);
    expect(connectHostForReach('computer', ['192.168.1.20'])).toBe('127.0.0.1');
    expect(connectHostForReach('network', ['192.168.1.20'])).toBe('192.168.1.20');
    expect(connectHostForReach('network', [])).toBe('127.0.0.1');
  });
});
