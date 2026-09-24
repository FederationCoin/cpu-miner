import { argon2id } from '@noble/hashes/argon2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const ARGON = { t: 2, m: 8192, p: 1, dkLen: 32, maxmem: 32 * 1024 * 1024 };

export type KeystoreBlob = {
  v: 1;
  kdf: 'argon2id';
  salt: string;
  nonce: string;
  ciphertext: string;
  receive: string;
};

export function phrasesEqual(a: string, b: string): boolean {
  return normalizePhrase(a) === normalizePhrase(b);
}

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

export async function wrapSeed(seed: Uint8Array, password: string, receive: string): Promise<KeystoreBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = argon2id(password, salt, ARGON);
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cryptoKey, seed as BufferSource));
  return {
    v: 1,
    kdf: 'argon2id',
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(cipher),
    receive,
  };
}

export async function unwrapSeed(blob: KeystoreBlob, password: string): Promise<Uint8Array> {
  if (blob.kdf !== 'argon2id' || blob.v !== 1) {
    throw new Error('unsupported keystore');
  }
  const key = argon2id(password, hexToBytes(blob.salt), ARGON);
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(blob.nonce) }, cryptoKey, hexToBytes(blob.ciphertext)),
    );
  } catch {
    throw new Error('wrong password');
  }
}

export function parseBlob(raw: string): KeystoreBlob | null {
  try {
    const v = JSON.parse(raw) as KeystoreBlob;
    if (v?.v !== 1 || v.kdf !== 'argon2id' || !v.salt || !v.ciphertext || !v.nonce || !v.receive) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function fingerprint(seed: Uint8Array): string {
  return bytesToHex(sha256(seed)).slice(0, 16);
}
