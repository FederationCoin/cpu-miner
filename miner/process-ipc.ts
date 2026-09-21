import type { IpcMain } from 'electron';
import { join } from 'node:path';
import { MAIN_IS_LIVE, parseChain, RPC_PORT_TESTNET, type MinerChain } from './chain.js';
import { probeExtras, resolveGatewayBin, resolveNodeBin, type ExtrasProbe } from './extras.js';
import { spawnGateway, type GatewaySession } from './gateway-process.js';
import { canStopNode, spawnNode, type NodeSession, type NodeStatus, IDLE_NODE_STATUS } from './node-process.js';
import { resolvePoolCli } from './pool.js';
import { cookiePath, defaultDatadir, loadCookie, rpcCall } from './rpc.js';
import { loadWalletBlob, saveWalletBlob } from './wallet-store.js';

export type ProcessIpcDeps = {
  here: string;
  resourcesPath: () => string;
  userData: () => string;
  emitLog: (mode: string, message: string, kind?: 'ok' | 'error') => void;
};

let nodeSession: NodeSession = { kind: 'idle' };
let gatewaySession: GatewaySession = { kind: 'idle' };
let nodeError = '';
let gatewayError = '';

export function stopAllProcesses(): void {
  if (nodeSession.kind === 'spawned') {
    nodeSession.child.kill();
  }
  nodeSession = { kind: 'idle' };
  if (gatewaySession.kind === 'spawned') {
    gatewaySession.child.kill();
  }
  gatewaySession = { kind: 'idle' };
}

export function registerProcessIpc(ipcMain: IpcMain, deps: ProcessIpcDeps): void {

  const extras = (): ExtrasProbe =>
    probeExtras(process.env, deps.here, deps.resourcesPath(), process.platform, () =>
      resolvePoolCli(process.env, deps.here, deps.resourcesPath()),
    );

  ipcMain.handle('extras:probe', (): ExtrasProbe => extras());

  ipcMain.handle('node:status', async (_e, chainRaw: unknown): Promise<NodeStatus> => {
    const chain = parseChain(chainRaw);
    if (nodeSession.kind !== 'idle' && nodeSession.chain === chain) {
      const height = await nodeHeight(chain).catch(() => 0);
      return {
        session: nodeSession.kind,
        chain,
        height,
        running: true,
        lastError: nodeError,
      };
    }
    const height = await nodeHeight(chain).catch(() => -1);
    if (height >= 0) {
      if (nodeSession.kind === 'idle') {
        nodeSession = { kind: 'attached', chain };
      }
      return {
        session: 'attached',
        chain,
        height,
        running: true,
        lastError: nodeError,
      };
    }
    if (nodeSession.kind !== 'idle' && nodeSession.chain !== chain) {
      return { ...IDLE_NODE_STATUS, lastError: nodeError };
    }
    return { ...IDLE_NODE_STATUS, lastError: nodeError };
  });

  ipcMain.handle('node:start', async (_e, chainRaw: unknown) => {
    try {
      const chain = parseChain(chainRaw);
      if (chain === 'main' && !MAIN_IS_LIVE) {
        throw new Error('MAIN is not live');
      }
      const height = await nodeHeight(chain).catch(() => -1);
      if (height >= 0) {
        nodeSession = { kind: 'attached', chain };
        nodeError = '';
        deps.emitLog('node', `attach ${chain} height ${height}`, 'ok');
        return { ok: true as const };
      }
      const bin = resolveNodeBin(process.env, deps.here, deps.resourcesPath());
      const child = spawnNode(bin, chain);
      nodeSession = { kind: 'spawned', child, chain };
      nodeError = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        const msg = chunk.trim();
        if (msg) {
          nodeError = msg.slice(0, 400);
          deps.emitLog('node', msg);
        }
      });
      child.on('exit', (code) => {
        if (nodeSession.kind === 'spawned' && nodeSession.child === child) {
          nodeSession = { kind: 'idle' };
          nodeError = `exited ${code ?? 0}`;
          deps.emitLog('node', `exit ${code ?? 0}`);
        }
      });
      deps.emitLog('node', `start ${chain}`, 'ok');
      return { ok: true as const };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      nodeError = error;
      deps.emitLog('node', error, 'error');
      return { ok: false as const, error };
    }
  });

  ipcMain.handle('node:stop', async () => {
    if (!canStopNode(nodeSession) || nodeSession.kind !== 'spawned') {
      return { ok: false as const, error: 'not a spawned node' };
    }
    nodeSession.child.kill();
    nodeSession = { kind: 'idle' };
    deps.emitLog('node', 'stop');
    return { ok: true as const };
  });

  ipcMain.handle('gateway:status', () => {
    if (gatewaySession.kind === 'idle') {
      return { session: 'idle' as const, running: false, lastError: gatewayError };
    }
    return { session: 'spawned' as const, running: true, chain: gatewaySession.chain, lastError: gatewayError };
  });

  ipcMain.handle(
    'gateway:start',
    async (
      _e,
      opts: { chain: unknown; poolAddress: string; poolHost?: string; poolPubkey?: string },
    ) => {
      try {
        const chain = parseChain(opts.chain);
        if (chain === 'main' && !MAIN_IS_LIVE) {
          throw new Error('MAIN is not live');
        }
        const datadir = defaultDatadir();
        const auth = loadCookie(cookiePath(datadir, chain));
        const bin = resolveGatewayBin(process.env, deps.here, deps.resourcesPath());
        const configPath = join(deps.userData(), 'datum-gateway', `${chain}.json`);
        const child = spawnGateway(bin, {
          chain,
          rpcUrl: `http://127.0.0.1:${RPC_PORT_TESTNET}`,
          rpcUser: auth.user,
          rpcPassword: auth.password,
          poolAddress: String(opts.poolAddress ?? '').trim(),
          poolHost: String(opts.poolHost ?? '').trim(),
          poolPubkey: String(opts.poolPubkey ?? '').trim(),
          configPath,
        });
        gatewaySession = { kind: 'spawned', child, chain };
        gatewayError = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
          const msg = chunk.trim();
          if (msg) {
            gatewayError = msg.slice(0, 400);
            deps.emitLog('gateway', msg);
          }
        });
        child.on('exit', (code) => {
          if (gatewaySession.kind === 'spawned' && gatewaySession.child === child) {
            gatewaySession = { kind: 'idle' };
            gatewayError = `exited ${code ?? 0}`;
            deps.emitLog('gateway', `exit ${code ?? 0}`);
          }
        });
        deps.emitLog('gateway', `start ${chain}`, 'ok');
        return { ok: true as const };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        gatewayError = error;
        deps.emitLog('gateway', error, 'error');
        return { ok: false as const, error };
      }
    },
  );

  ipcMain.handle('gateway:stop', async () => {
    if (gatewaySession.kind !== 'spawned') {
      return { ok: false as const, error: 'not a spawned gateway' };
    }
    gatewaySession.child.kill();
    gatewaySession = { kind: 'idle' };
    deps.emitLog('gateway', 'stop');
    return { ok: true as const };
  });

  ipcMain.handle('wallet:load', (_e, chainRaw: unknown) => loadWalletBlob(deps.userData(), chainRaw));
  ipcMain.handle('wallet:save', (_e, chainRaw: unknown, blob: string) => {
    saveWalletBlob(deps.userData(), chainRaw, blob);
    return { ok: true as const };
  });
}

async function nodeHeight(chain: MinerChain): Promise<number> {
  const datadir = defaultDatadir();
  const auth = loadCookie(cookiePath(datadir, chain));
  const result = await rpcCall(auth, 'getblockcount', [], { port: RPC_PORT_TESTNET });
  const n = typeof result === 'number' ? result : Number(result);
  if (!Number.isFinite(n)) {
    throw new Error('bad height');
  }
  return n;
}
