import { describe, expect, it } from 'vitest';
import {
  authorizeLine,
  isAuthorizeOk,
  parseNotify,
  parseSubscribeResult,
  subscribeLine,
  submitLine,
} from './stratum.js';

describe('stratum wire', () => {
  it('subscribe line uses the miner UA', () => {
    expect(JSON.parse(subscribeLine(1))).toEqual({
      id: 1,
      method: 'mining.subscribe',
      params: ['federationcoin-cpu-miner/0.1'],
    });
  });

  it('parses stratum-proxy subscribe result', () => {
    const line = {
      error: null,
      id: 1,
      result: [
        [
          ['mining.notify', 'abcd0001'],
          ['mining.set_difficulty', 'abcd0002'],
        ],
        'abcd0000',
        8,
      ],
    };
    const sub = parseSubscribeResult(line);
    expect(sub?.extraNonce2Size).toBe(8);
    expect(sub?.extraNonce1).toHaveLength(4);
  });

  it('parses DATUM-shaped notify like stratum-proxy notify_line', () => {
    const prev = '11'.repeat(32);
    const coinb1 = '22'.repeat(39);
    const ntime = '33445566';
    const msg = {
      id: null,
      method: 'mining.notify',
      params: ['0000000100', prev, coinb1, '', [], '20000000', '1d00ffff', ntime, true],
    };
    const job = parseNotify(msg);
    expect(job?.jobId).toBe('0000000100');
    expect(job?.prevHidden).toHaveLength(32);
    expect(job?.coinb1).toHaveLength(39);
    expect(job?.nBits).toBe(0x1d00ffff);
    expect(job?.ntime8[0]).toBe(0x33);
  });

  it('parses string-only notify the way fcminer collects params', () => {
    const prev = '11'.repeat(32);
    const coinb1 = '22'.repeat(39);
    const ntime = '33445566';
    const job = parseNotify({
      method: 'mining.notify',
      params: ['job1', prev, coinb1, '', '20000000', '1d00ffff', ntime],
    });
    expect(job?.jobId).toBe('job1');
    expect(job?.nBits).toBe(0x1d00ffff);
    expect(job?.ntime8[0]).toBe(0x33);
  });

  it('rejects 80-byte Bitcoin coinb1', () => {
    const prev = '11'.repeat(32);
    const coinb1 = '22'.repeat(80);
    const msg = {
      method: 'mining.notify',
      params: ['j', prev, coinb1, '', [], '20000000', '1d00ffff', '00112233', true],
    };
    expect(parseNotify(msg)).toBeNull();
  });

  it('authorize and submit JSON match fcminer', () => {
    expect(JSON.parse(authorizeLine(2, 'tfcn1abc.cpu', 'x'))).toEqual({
      id: 2,
      method: 'mining.authorize',
      params: ['tfcn1abc.cpu', 'x'],
    });
    const en2 = new Uint8Array(8);
    const ntime = new Uint8Array(8);
    const nonce = new Uint8Array(8);
    en2[0] = 1;
    const rec = JSON.parse(submitLine(10, 'tfcn1abc.cpu', 'job1', en2, ntime, nonce)) as {
      params: string[];
    };
    expect(rec.params[0]).toBe('tfcn1abc.cpu');
    expect(rec.params[1]).toBe('job1');
    expect(rec.params[2]).toHaveLength(16);
    expect(isAuthorizeOk({ id: 2, result: true, error: null })).toBe(true);
    expect(isAuthorizeOk({ id: 2, result: false })).toBe(false);
  });
});
