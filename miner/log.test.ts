import { describe, expect, it } from 'vitest';
import { logHistory, pushLog, redactSecret } from './log.js';

describe('redactSecret', () => {
  it('redacts cookie-length secrets and leaves short passwords alone', () => {
    expect(redactSecret('cookie=s3cretvalue', 's3cretvalue')).toBe('cookie=***');
    expect(redactSecret('password x ok', 'x')).toBe('password x ok');
  });
});

describe('log ring', () => {
  it('caps at 500 lines', () => {
    const before = logHistory().length;
    for (let i = 0; i < 505; i++) {
      pushLog('rpc', `line-${before}-${i}`);
    }
    expect(logHistory().length).toBe(500);
  });
});
