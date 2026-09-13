import { describe, expect, it } from 'vitest';
import { MAIN_IS_LIVE, RPC_PORT_MAIN, RPC_PORT_TESTNET, defaultRpcPort, parseChain } from './chain.js';

describe('parseChain', () => {
  it('accepts main and testnet', () => {
    expect(parseChain('main')).toBe('main');
    expect(parseChain('testnet')).toBe('testnet');
  });

  it('rejects anything else', () => {
    expect(() => parseChain('signet')).toThrow(/chain must be main or testnet/);
    expect(() => parseChain('')).toThrow(/chain must be main or testnet/);
    expect(() => parseChain(undefined)).toThrow(/chain must be main or testnet/);
  });
});

describe('defaultRpcPort', () => {
  it('uses 4094 on main and 35332 on testnet', () => {
    expect(RPC_PORT_MAIN).toBe(4094);
    expect(RPC_PORT_TESTNET).toBe(35332);
    expect(defaultRpcPort('main')).toBe(4094);
    expect(defaultRpcPort('testnet')).toBe(35332);
  });
});

describe('MAIN_IS_LIVE', () => {
  it('is false until dummy MAIN is replaced', () => {
    expect(MAIN_IS_LIVE).toBe(false);
  });
});
