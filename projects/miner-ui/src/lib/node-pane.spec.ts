import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { NodePane } from './node-pane';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, desktopShell, webDemoShell } from './miner-shell';
import { ExtrasService } from './extras.service';

function host(probe: { node: boolean; gateway: boolean; pool: boolean }, extras: Partial<HasherHost> = {}): HasherHost {
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
    nodeStatus: async () => ({ session: 'idle', chain: null, height: 0, running: false, lastError: '' }),
    nodeStart: async () => ({ ok: true }),
    nodeStop: async () => ({ ok: true }),
    ...extras,
  };
}

async function render(kind: 'desktop' | 'web', h: HasherHost): Promise<ComponentFixture<NodePane>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [NodePane],
    providers: [
      { provide: HASHER_HOST, useValue: h },
      { provide: MINER_SHELL, useValue: kind === 'web' ? webDemoShell() : desktopShell() },
      ExtrasService,
    ],
  }).compileComponents();
  const extras = TestBed.inject(ExtrasService);
  await extras.refresh();
  const f = TestBed.createComponent(NodePane);
  f.componentRef.setInput('chain', 'testnet');
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return f;
}

describe('NodePane', () => {
  it('shows a download CTA on the web mill', async () => {
    const f = await render('web', host({ node: false, gateway: false, pool: false }));
    expect(f.nativeElement.querySelector('[data-node-download]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-addon-missing]')).toBeNull();
  });

  it('shows the missing-addon card when the desktop extra is absent', async () => {
    const f = await render('desktop', host({ node: false, gateway: false, pool: true }));
    expect(f.nativeElement.querySelector('[data-addon-missing="Node"]')).toBeTruthy();
  });

  it('shows Start when present and hides Stop unless spawned', async () => {
    const f = await render(
      'desktop',
      host({ node: true, gateway: false, pool: true }, {
        nodeStatus: async () => ({ session: 'spawned', chain: 'testnet', height: 1, running: true, lastError: '' }),
      }),
    );
    expect(f.nativeElement.querySelector('#testnet-node-start')).toBeTruthy();
    expect(f.nativeElement.querySelector('#testnet-node-stop')).toBeTruthy();
  });
});
