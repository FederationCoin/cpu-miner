import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { CHAINS, type MinerChain } from './chain';
import { encodeAddress } from './wallet-bech32';
import { normalizePhrase } from './wallet-crypto';

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
  const coin = chain === 'main' ? 0 : 1;
  const hd = HDKey.fromMasterSeed(seed).derive(`m/84'/${coin}'/0'/0/0`);
  if (!hd.publicKey) {
    throw new Error('derive failed');
  }
  const hrp = CHAINS[chain].hrp;
  const prog = hash160(hd.publicKey);
  const addr = encodeAddress(hrp, 0, prog);
  if (!addr) {
    throw new Error('encode failed');
  }
  return addr;
}

export function derivePrivateKey(seed: Uint8Array, chain: MinerChain): Uint8Array {
  const coin = chain === 'main' ? 0 : 1;
  const hd = HDKey.fromMasterSeed(seed).derive(`m/84'/${coin}'/0'/0/0`);
  if (!hd.privateKey) {
    throw new Error('derive failed');
  }
  return hd.privateKey;
}

function hash160(pub: Uint8Array): Uint8Array {
  return ripemd160(sha256(pub));
}
