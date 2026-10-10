import { describe, expect, it } from 'vitest';
import { fetchHttpsText } from './prime-keys.js';

function jsonResponse(status: number, body = '{}', headers?: HeadersInit): Response {
  return new Response(body, { status, headers });
}

describe('fetchHttpsText', () => {
  it('returns the body of an https document', async () => {
    const text = await fetchHttpsText('https://pool.example/keys.json', async () => jsonResponse(200, '{"ed25519":"aa"}'));
    expect(text).toContain('ed25519');
  });

  it('rejects http, userinfo, redirects, and errors', async () => {
    await expect(fetchHttpsText('http://pool.example/keys.json', async () => jsonResponse(200))).rejects.toThrow(/https/);
    await expect(fetchHttpsText('https://user:pw@pool.example/keys.json', async () => jsonResponse(200))).rejects.toThrow(/userinfo/);
    await expect(fetchHttpsText('not a url', async () => jsonResponse(200))).rejects.toThrow(/invalid/);
    await expect(fetchHttpsText('https://pool.example/keys.json', async () => jsonResponse(302))).rejects.toThrow(/redirect/);
    await expect(fetchHttpsText('https://pool.example/keys.json', async () => jsonResponse(404))).rejects.toThrow(/HTTP 404/);
  });
});
