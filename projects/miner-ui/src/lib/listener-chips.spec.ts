import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { EMPTY_GATEWAY_STATUS, EMPTY_NODE_STATUS } from './miner-api';
import { ListenerChips } from './listener-chips';

describe('ListenerChips', () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return data.size;
        },
        clear: () => data.clear(),
        getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
        key: (index: number) => [...data.keys()][index] ?? null,
        removeItem: (key: string) => data.delete(key),
        setItem: (key: string, value: string) => data.set(key, value),
      },
    });
  });

  it('shows a running node and gateway and copies the connect string', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const host: Partial<HasherHost> = {
      nodeStatus: async () => ({
        ...EMPTY_NODE_STATUS,
        running: true,
        connectHost: '192.168.1.20',
        connectPort: 35332,
      }),
      gatewayStatus: async () => ({
        ...EMPTY_GATEWAY_STATUS,
        running: true,
        connectHost: '192.168.1.20',
        connectPort: 23334,
      }),
    };
    await TestBed.configureTestingModule({
      imports: [ListenerChips],
      providers: [{ provide: HASHER_HOST, useValue: host }],
    }).compileComponents();
    const f: ComponentFixture<ListenerChips> = TestBed.createComponent(ListenerChips);
    f.detectChanges();
    await f.componentInstance.refresh();
    f.detectChanges();
    expect(f.nativeElement.querySelector('#node-chip')?.textContent).toContain('node: 192.168.1.20:35332');
    expect(f.nativeElement.querySelector('#gateway-chip')?.textContent).toContain('datum gateway: 192.168.1.20:23334');
    f.nativeElement.querySelector('#node-copy').click();
    expect(writeText).toHaveBeenCalledWith('192.168.1.20:35332');
  });

  it('hides chips when nothing is running', async () => {
    const host: Partial<HasherHost> = {
      nodeStatus: async () => EMPTY_NODE_STATUS,
      gatewayStatus: async () => EMPTY_GATEWAY_STATUS,
    };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ListenerChips],
      providers: [{ provide: HASHER_HOST, useValue: host }],
    }).compileComponents();
    const f = TestBed.createComponent(ListenerChips);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('#node-chip')).toBeNull();
    expect(f.nativeElement.querySelector('#gateway-chip')).toBeNull();
  });
});
