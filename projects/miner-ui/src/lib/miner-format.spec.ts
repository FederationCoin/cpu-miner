import { cookiePathHint, formatHashRate, formatSats, gpuStatusHint, gpuStatusHintWeb, mainIsNotLive } from './miner-format';

describe('gpuStatusHintWeb', () => {
  it('covers detecting, unscanned, missing adapter, and ready', () => {
    expect(gpuStatusHintWeb({ detecting: true, scanned: false, addon: false, deviceCount: 0 })).toMatch(/WebGPU adapter/);
    expect(gpuStatusHintWeb({ detecting: false, scanned: false, addon: false, deviceCount: 0 })).toMatch(/Open Help/);
    expect(gpuStatusHintWeb({ detecting: false, scanned: true, addon: false, deviceCount: 0 })).toMatch(/Open Help/);
    expect(
      gpuStatusHintWeb({ detecting: false, scanned: true, addon: false, deviceCount: 0, reason: 'no-api' }),
    ).toMatch(/no WebGPU API/);
    expect(gpuStatusHintWeb({ detecting: false, scanned: true, addon: false, deviceCount: 1 })).toMatch(/Off until you pick WebGPU/);
  });
});

describe('mainIsNotLive', () => {
  it('is true only for dummy MAIN', () => {
    expect(mainIsNotLive('main', false)).toBe(true);
    expect(mainIsNotLive('main', true)).toBe(false);
    expect(mainIsNotLive('testnet', false)).toBe(false);
    expect(mainIsNotLive('testnet', true)).toBe(false);
  });
});

describe('gpuStatusHint', () => {
  it('covers detecting, unscanned, missing addon, no devices, and ready', () => {
    expect(gpuStatusHint({ detecting: true, scanned: false, addon: false, deviceCount: 0 })).toMatch(/Loading GPU/);
    expect(gpuStatusHint({ detecting: false, scanned: false, addon: false, deviceCount: 0 })).toMatch(/No GPUs listed yet/);
    expect(gpuStatusHint({ detecting: false, scanned: true, addon: false, deviceCount: 0 })).toMatch(/No GPU hasher/);
    expect(gpuStatusHint({ detecting: false, scanned: true, addon: true, deviceCount: 0 })).toMatch(/No OpenCL or CUDA GPUs/);
    expect(gpuStatusHint({ detecting: false, scanned: true, addon: true, deviceCount: 1 })).toMatch(/Off until you pick a strategy/);
  });
});

describe('cookiePathHint', () => {
  it('uses datadir/.cookie on main', () => {
    expect(cookiePathHint('', 'main')).toBe('');
    expect(cookiePathHint('/home/me/.federationcoin/', 'main')).toBe('/home/me/.federationcoin/.cookie');
  });

  it('nests testnet3 unless the datadir already is testnet3', () => {
    expect(cookiePathHint('', 'testnet')).toBe('');
    expect(cookiePathHint('/home/me/.federationcoin/testnet3', 'testnet')).toBe('/home/me/.federationcoin/testnet3/.cookie');
    expect(cookiePathHint('/home/me/.federationcoin', 'testnet')).toBe('/home/me/.federationcoin/testnet3/.cookie');
  });
});

describe('formatSats', () => {
  it('formats whole tokens to 8 decimals without float', () => {
    expect(formatSats('5000000000')).toBe('50.00000000');
    expect(formatSats('34180')).toBe('0.00034180');
  });
});
