import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ExtrasService } from './extras.service';
import { HASHER_HOST, type HasherHost } from './hasher-host';

function host(probe: { node: boolean; gateway: boolean; pool: boolean }): HasherHost {
  return {
    canMine: true,
    inElectron: true,
    start: async () => ({ ok: true }),
    stop: async () => undefined,
    info: async () => null,
    gpus: async () => ({ devices: [], addon: false }),
    pickDatadir: async () => null,
    onStats: () => () => undefined,
    onToast: () => () => undefined,
    poolStart: async () => ({ ok: true }),
    poolStop: async () => undefined,
    onPoolStats: () => () => undefined,
    extrasProbe: async () => probe,
  };
}

describe('ExtrasService', () => {
  it('loads present vs missing probe booleans', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HASHER_HOST, useValue: host({ node: true, gateway: false, pool: true }) }],
    });
    const s = TestBed.inject(ExtrasService);
    await s.refresh();
    expect(s.probe()).toEqual({ node: true, gateway: false, pool: true });
    expect(s.ready()).toBe(true);
  });

  it('treats a host without extrasProbe as all missing', async () => {
    TestBed.resetTestingModule();
    const h = host({ node: true, gateway: true, pool: true });
    delete (h as { extrasProbe?: unknown }).extrasProbe;
    TestBed.configureTestingModule({
      providers: [{ provide: HASHER_HOST, useValue: h }],
    });
    const s = TestBed.inject(ExtrasService);
    await s.refresh();
    expect(s.probe()).toEqual({ node: false, gateway: false, pool: false });
  });
});
