export async function fetchHttpsText(url: string, fetchFn: typeof fetch = fetch): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('keys URL is invalid');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('keys URL must be https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('keys URL must not include userinfo');
  }
  const res = await fetchFn(parsed.toString(), { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    throw new Error('keys URL must not redirect');
  }
  if (!res.ok) {
    throw new Error(`keys URL HTTP ${res.status}`);
  }
  return res.text();
}
