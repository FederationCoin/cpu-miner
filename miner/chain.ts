/** Main-process chain ids. Keep MAIN_IS_LIVE in sync with src/app/chain.ts. */

export type MinerChain = 'main' | 'testnet';

/** Dummy MAIN is not launched. Flip when identity is restored (golive-notes). */
export const MAIN_IS_LIVE = false;

export const RPC_PORT_MAIN = 4094;
export const RPC_PORT_TESTNET = 35332;
export const STRATUM_PORT_DEFAULT = 23334;
export const DATUM_PORT_DEFAULT = 28916;

export function parseChain(raw: unknown): MinerChain {
  if (raw === 'main' || raw === 'testnet') {
    return raw;
  }
  throw new Error('chain must be main or testnet');
}

export function defaultRpcPort(chain: MinerChain): number {
  return chain === 'main' ? RPC_PORT_MAIN : RPC_PORT_TESTNET;
}
