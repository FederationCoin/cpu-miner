import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseChain, type MinerChain } from './chain.js';

export function walletPath(userData: string, chain: MinerChain): string {
  return join(userData, 'keystore', `${chain}.json`);
}

export function loadWalletBlob(userData: string, chainRaw: unknown): string | null {
  const chain = parseChain(chainRaw);
  const path = walletPath(userData, chain);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, 'utf8');
}

export function saveWalletBlob(userData: string, chainRaw: unknown, blob: string): void {
  const chain = parseChain(chainRaw);
  if (!blob.trim()) {
    throw new Error('keystore blob is empty');
  }
  const path = walletPath(userData, chain);
  mkdirSync(join(userData, 'keystore'), { recursive: true });
  writeFileSync(path, blob);
}
