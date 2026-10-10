import { describe, expect, it } from 'vitest';
import { formatStratumReject } from './stratum-reject';

describe('formatStratumReject', () => {
  it('maps the high-hash array toast to English', () => {
    expect(formatStratumReject([23, 'high-hash', null])).toBe('Share was not hard enough');
  });

  it('maps a stringified array the same way', () => {
    expect(formatStratumReject('[23,"high-hash",null]')).toBe('Share was not hard enough');
  });

  it('maps other gateway reject codes', () => {
    expect(formatStratumReject([21, 'stale-work', null])).toBe('Share arrived after the job changed');
    expect(formatStratumReject('duplicate')).toBe('That share was already submitted');
  });

  it('falls back without dumping JSON', () => {
    expect(formatStratumReject(null)).toBe('Share rejected');
    expect(formatStratumReject({ nope: true })).toBe('Share rejected');
  });
});
