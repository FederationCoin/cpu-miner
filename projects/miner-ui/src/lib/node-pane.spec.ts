import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { NodePane } from './node-pane';
import { installMemoryStorage } from './test-storage';
import { HASHER_HOST, type HasherHost } from './hasher-host';
import { MINER_SHELL, desktopShell, webDemoShell } from './miner-shell';
import { ExtrasService } from './extras.service';
import { EMPTY_NODE_STATUS } from './miner-api';

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
    nodeStatus: async () => EMPTY_NODE_STATUS,
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
  beforeEach(() => {
    installMemoryStorage();
  });

  it('shows a download CTA on the web mill', async () => {
    const f = await render('web', host({ node: false, gateway: false, pool: false }));
    expect(f.nativeElement.querySelector('[data-node-download]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-addon-missing]')).toBeNull();
  });

  it('shows the missing-addon card when the desktop extra is absent', async () => {
    const f = await render('desktop', host({ node: false, gateway: false, pool: true }));
    expect(f.nativeElement.querySelector('[data-addon-missing="Node"]')).toBeTruthy();
  });

  it('hides Start and shows Stop when this app spawned the node', async () => {
    const f = await render(
      'desktop',
      host({ node: true, gateway: false, pool: true }, {
        nodeStatus: async () => ({ ...EMPTY_NODE_STATUS, session: 'spawned', chain: 'testnet', height: 1, running: true, command: 'federationcoind -testnet' }),
      }),
    );
    expect(f.nativeElement.querySelector('#testnet-node-start')).toBeNull();
    expect(f.nativeElement.querySelector('#testnet-node-stop')).toBeTruthy();
    expect(f.nativeElement.querySelector('#testnet-node-command')?.textContent).toContain('-testnet');
    expect(f.nativeElement.textContent).toMatch(/Poll now/);
  });

  it('shows Starting and ignores a second click until the first start finishes', async () => {
    let release: (value: { ok: boolean }) => void = () => undefined;
    let calls = 0;
    const f = await render(
      'desktop',
      host({ node: true, gateway: false, pool: true }, {
        nodeStart: () => {
          calls += 1;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      }),
    );
    const start = f.nativeElement.querySelector('#testnet-node-start') as HTMLButtonElement;
    start.click();
    f.detectChanges();
    const starting = f.nativeElement.querySelector('#testnet-node-start') as HTMLButtonElement;
    expect(starting.disabled).toBe(true);
    expect(starting.textContent).toContain('Starting');
    starting.click();
    expect(calls).toBe(1);
    release({ ok: true });
    await f.whenStable();
  });

  it('shows Kill and keeps Start when a node this app did not spawn holds the port', async () => {
    const warning =
      'A pre-existing node process is already running. This may have been started externally or from a prior run of this application left orphaned. It must be shut down before we can spawn a new node process here.';
    const f = await render(
      'desktop',
      host({ node: true, gateway: false, pool: true }, {
        nodeStatus: async () => ({
          ...EMPTY_NODE_STATUS,
          portTaken: warning,
          pid: 42,
          height: 237,
          foreignPids: [42],
        }),
      }),
    );
    expect(f.nativeElement.querySelector('#testnet-node-port-taken')?.textContent).toContain('pre-existing node process');
    expect(f.nativeElement.querySelector('#testnet-node-start')).toBeTruthy();
    expect(f.nativeElement.querySelector('#testnet-node-stop')).toBeNull();
    expect(f.nativeElement.querySelector('#testnet-node-kill-42')?.textContent).toContain('42');
    expect(f.nativeElement.querySelector('#testnet-node-pid')?.textContent).toContain('42');
  });

  it('shows Start while idle', async () => {
    const f = await render('desktop', host({ node: true, gateway: false, pool: true }));
    expect(f.nativeElement.querySelector('#testnet-node-start')).toBeTruthy();
    expect(f.nativeElement.querySelector('#testnet-node-stop')).toBeNull();
  });

  it('restores a saved datadir on init and does not overwrite it with status', async () => {
    localStorage.setItem('fc.testnet.node.datadir', 'D:\\saved-node');
    const f = await render(
      'desktop',
      host({ node: true, gateway: false, pool: true }, {
        nodeStatus: async () => ({ ...EMPTY_NODE_STATUS, datadir: 'C:\\default' }),
      }),
    );
    expect((f.nativeElement.querySelector('#testnet-node-path') as HTMLInputElement).value).toBe('D:\\saved-node');
  });

  it('kills a listed foreign pid', async () => {
    let killed = 0;
    const f = await render(
      'desktop',
      host({ node: true, gateway: false, pool: true }, {
        nodeStatus: async () => ({ ...EMPTY_NODE_STATUS, portTaken: 'held', foreignPids: [99] }),
        nodeKillForeign: async (pid) => {
          killed = pid;
          return { ok: true };
        },
      }),
    );
    (f.nativeElement.querySelector('#testnet-node-kill-99') as HTMLButtonElement).click();
    await f.whenStable();
    expect(killed).toBe(99);
  });
});
