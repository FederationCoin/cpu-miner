import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { CHAINS, type MinerChain } from './chain';
import { encodeAddress } from './wallet-bech32';
import { normalizePhrase } from './wallet-crypto';
import { childSeed, keyHash, keygen } from './wallet-mldsa';

export type PhraseStrength = 128 | 256;

export function createPhrase(strength: PhraseStrength): string {
  return generateMnemonic(wordlist, strength);
}

export function phraseWordCount(phrase: string): 12 | 24 | null {
  const n = normalizePhrase(phrase).split(' ').length;
  return n === 12 || n === 24 ? n : null;
}

export function isValidPhrase(phrase: string): boolean {
  return validateMnemonic(normalizePhrase(phrase), wordlist);
}

export function seedFromPhrase(phrase: string): Uint8Array {
  return mnemonicToSeedSync(normalizePhrase(phrase));
}

export function deriveReceive(seed: Uint8Array, chain: MinerChain): string {
  const child = childSeed(seed, 0);
  const { publicKey } = keygen(child);
  const hrp = CHAINS[chain].hrp;
  const addr = encodeAddress(hrp, 0, keyHash(publicKey));
  if (!addr) {
    throw new Error('encode failed');
  }
  return addr;
}

export function derivePrivateKey(seed: Uint8Array, chain: MinerChain): Uint8Array {
  void chain;
  return childSeed(seed, 0);
}
