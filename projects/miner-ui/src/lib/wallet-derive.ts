import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { CHAINS, type MinerChain } from './chain';
import { encodeAddress } from './wallet-bech32';
import { normalizePhrase } from './wallet-crypto';
import { childSeed, keyHash, keygen } from './wallet-mldsa';
import { childSeed87, keyHash87, keygen87 } from './wallet-mldsa87';
import { childSeedSecp, compressedPubkey, hash160 } from './wallet-secp';

export type PhraseStrength = 128 | 256;
export type ReceiveKind = 'mldsa87' | 'mldsa44' | 'secp';

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

function encodeV0(program: Uint8Array, chain: MinerChain): string {
  const hrp = CHAINS[chain].hrp;
  const addr = encodeAddress(hrp, 0, program);
  if (!addr) {
    throw new Error('encode failed');
  }
  return addr;
}

export function deriveReceive87(seed: Uint8Array, chain: MinerChain): string {
  const { publicKey } = keygen87(childSeed87(seed, 0));
  return encodeV0(keyHash87(publicKey), chain);
}

export function deriveReceive44(seed: Uint8Array, chain: MinerChain): string {
  const { publicKey } = keygen(childSeed(seed, 0));
  return encodeV0(keyHash(publicKey), chain);
}

export function deriveReceiveSecp(seed: Uint8Array, chain: MinerChain): string {
  const pub = compressedPubkey(childSeedSecp(seed, 0));
  return encodeV0(hash160(pub), chain);
}

/** Default receive is Dilithium 87. */
export function deriveReceive(seed: Uint8Array, chain: MinerChain): string {
  return deriveReceive87(seed, chain);
}

export function derivePrivateKey(seed: Uint8Array, chain: MinerChain): Uint8Array {
  void chain;
  return childSeed87(seed, 0);
}

export function derivePrivateKey44(seed: Uint8Array, chain: MinerChain): Uint8Array {
  void chain;
  return childSeed(seed, 0);
}

export function derivePrivateKeySecp(seed: Uint8Array, chain: MinerChain): Uint8Array {
  void chain;
  return childSeedSecp(seed, 0);
}
