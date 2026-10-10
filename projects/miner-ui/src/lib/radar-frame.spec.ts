import { describe, expect, it } from 'vitest';
import { radarAllowsIframe } from './radar-frame';

describe('radar frame probe', () => {
  it('allows framing when headers are empty and refuses XFO or frame-ancestors', () => {
    expect(radarAllowsIframe(null, null)).toBe(true);
    expect(radarAllowsIframe('', '')).toBe(true);
    expect(radarAllowsIframe('DENY', null)).toBe(false);
    expect(radarAllowsIframe(null, "default-src 'self'; frame-ancestors 'none'")).toBe(false);
  });
});
