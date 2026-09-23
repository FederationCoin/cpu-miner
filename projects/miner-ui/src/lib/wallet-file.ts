import { parseBlob, type KeystoreBlob } from './wallet-crypto';

export type WalletRecord = { id: string; blob: KeystoreBlob };

export type WalletStoreFile = {
  wallets: WalletRecord[];
  selectedId: string;
  mineToId: string;
};

export function newWalletId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return `w-${Date.now()}`;
}

export function parseWalletStore(raw: string): WalletStoreFile | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (isStore(json)) {
    return json;
  }
  const blob = parseBlob(text);
  if (!blob) {
    return null;
  }
  const id = blob.receive.slice(0, 16) || 'wallet';
  return { wallets: [{ id, blob }], selectedId: id, mineToId: '' };
}

export function storeWasList(raw: string): boolean {
  try {
    const json = JSON.parse(raw) as { wallets?: unknown };
    return Array.isArray(json.wallets);
  } catch {
    return false;
  }
}

function isStore(v: unknown): v is WalletStoreFile {
  if (!v || typeof v !== 'object') {
    return false;
  }
  const o = v as WalletStoreFile;
  if (!Array.isArray(o.wallets) || typeof o.selectedId !== 'string' || typeof o.mineToId !== 'string') {
    return false;
  }
  return o.wallets.every((w) => {
    if (!w || typeof w !== 'object') {
      return false;
    }
    const rec = w as WalletRecord;
    return typeof rec.id === 'string' && !!parseBlob(JSON.stringify(rec.blob));
  });
}
