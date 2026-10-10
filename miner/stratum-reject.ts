const REJECT_PHRASE: Record<string, string> = {
  'high-hash': 'Share was not hard enough',
  'stale-work': 'Share arrived after the job changed',
  'stale-prevblk': 'Share arrived after a new block',
  duplicate: 'That share was already submitted',
  'unknown-work': 'That job is no longer live',
  'time-too-old': 'Share timestamp is too old',
  'time-too-new': 'Share timestamp is too new',
  'H-not-zero': 'Share hash was not valid',
  'bad-version': 'Share version bits were not valid',
};

function phraseFromCode(code: string): string {
  return REJECT_PHRASE[code] ?? code.replace(/-/g, ' ');
}

/** Map Stratum JSON-RPC error (string or [code, "reason", extra]) to a short toast. */
export function formatStratumReject(error: unknown): string {
  if (error == null) {
    return 'Share rejected';
  }
  if (typeof error === 'string') {
    const trimmed = error.trim();
    if (trimmed.startsWith('[')) {
      try {
        return formatStratumReject(JSON.parse(trimmed) as unknown);
      } catch {
        return phraseFromCode(trimmed);
      }
    }
    return phraseFromCode(trimmed);
  }
  if (Array.isArray(error) && error.length >= 2 && typeof error[1] === 'string') {
    return phraseFromCode(error[1]);
  }
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return phraseFromCode(error.message);
  }
  return 'Share rejected';
}
