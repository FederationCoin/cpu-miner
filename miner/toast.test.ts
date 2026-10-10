import { describe, expect, it } from 'vitest';
import { toastKindFromMessage } from './toast.js';

describe('toastKindFromMessage', () => {
  it('treats mining start as success', () => {
    expect(toastKindFromMessage('start testnet stratum')).toBe('ok');
    expect(toastKindFromMessage('mining height 12')).toBe('ok');
  });

  it('treats rejects and refusals as errors', () => {
    expect(toastKindFromMessage('Share was not hard enough')).toBe('error');
    expect(toastKindFromMessage('ECONNREFUSED')).toBe('error');
    expect(toastKindFromMessage('gpu: start failed cuda:0')).toBe('error');
    expect(toastKindFromMessage('MAIN is not live')).toBe('error');
  });
});
