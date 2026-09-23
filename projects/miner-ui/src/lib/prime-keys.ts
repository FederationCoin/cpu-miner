export function identityPubkeyFromKeysDocument(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const rec = raw as { ed25519?: unknown; x25519?: unknown };
  const ed = typeof rec.ed25519 === 'string' ? rec.ed25519.trim().toLowerCase() : '';
  const x = typeof rec.x25519 === 'string' ? rec.x25519.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(ed) || !/^[0-9a-f]{64}$/.test(x)) {
    return null;
  }
  return ed + x;
}

export function applyFetchedIdentity(current: string, fetched: string): { pubkey: string; mismatch: boolean } {
  const got = fetched.trim().toLowerCase();
  const cur = current.trim().toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(got)) {
    return { pubkey: cur, mismatch: true };
  }
  if (cur && cur !== got) {
    return { pubkey: cur, mismatch: true };
  }
  return { pubkey: got, mismatch: false };
}
