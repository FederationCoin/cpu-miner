import { spawnSync, type ChildProcess } from 'node:child_process';
import type { IpcMain } from 'electron';
import { join } from 'node:path';
import { MAIN_IS_LIVE, parseChain, RPC_PORT_TESTNET, defaultRpcPort, type MinerChain } from './chain.js';
import { probeExtras, resolveGatewayBin, resolveNodeBin, type ExtrasProbe } from './extras.js';
import { gatewayCommand, spawnGateway, type GatewaySession } from './gateway-process.js';
import {
  canStopNode,
  nodeCommand,
  nodePortLines,
  spawnNode,
  type NodeSession,
  type NodeStatus,
  IDLE_NODE_STATUS,
} from './node-process.js';
import { resolvePoolCli } from './pool.js';
import { cookiePath, defaultDatadir, loadCookie, rpcCall } from './rpc.js';
import { loadWalletBlob, saveWalletBlob } from './wallet-store.js';
import { fetchHttpsText } from './prime-keys.js';
import {
  gatewayPorts,
  nodeDebugLogPath,
  otherProcessCount,
  peersFromRpc,
  pidsFromLines,
  pidsWithCommIn,
  pushRing,
  readLogTail,
  readUsage,
  trafficFromRpc,
  txNote,
  txsFromRpc,
  usageFromWindowsLine,
  type TickSample,
} from './process-usage.js';

export type ProcessIpcDeps = {
  here: string;
  resourcesPath: () => string;
  userData: () => string;
  emitLog: (mode: string, message: string, kind?: 'ok' | 'error') => void;
};

export type GatewayStatus = {
  session: 'idle' | 'spawned';
  running: boolean;
  chain: MinerChain | null;
  lastError: string;
  pid: number | null;
  command: string;
  configPath: string;
  cpu: string;
  rss: string;
  otherCount: number;
  ports: { label: string; port: number }[];
  logTail: string;
};

let nodeSession: NodeSession = { kind: 'idle' };
let gatewaySession: GatewaySession = { kind: 'idle' };
let nodeError = '';
let gatewayError = '';
let gatewayLog: string[] = [];
const cpuPrev = new Map<number, TickSample>();
const winPrev = new Map<number, { cpu: number; at: number }>();

export function stopAllProcesses(): void {
  if (nodeSession.kind === 'spawned') {
    nodeSession.child.kill();
  }
  nodeSession = { kind: 'idle' };
  if (gatewaySession.kind === 'spawned') {
    gatewaySession.child.kill();
  }
  gatewaySession = { kind: 'idle' };
  gatewayLog = [];
}

export function registerProcessIpc(ipcMain: IpcMain, deps: ProcessIpcDeps): void {
  const extras = (): ExtrasProbe =>
    probeExtras(process.env, deps.here, deps.resourcesPath(), process.platform, () =>
      resolvePoolCli(process.env, deps.here, deps.resourcesPath()),
    );

  ipcMain.handle('extras:probe', (): ExtrasProbe => extras());

  ipcMain.handle('node:status', async (_e, raw: unknown): Promise<NodeStatus> => {
    const requested = chainDatadir(raw, defaultDatadir());
    const chain = requested.chain;
    const datadir = nodeDatadir(chain, requested.datadir);
    const owned = nodeSession.kind === 'spawned' && nodeSession.chain === chain ? nodeSession : null;
    const pid = owned?.child.pid ?? null;
    const usage = samplePid(pid);
    let height = -1;
    let peers: NodeStatus['peers'] = [];
    let trafficIn = '';
    let trafficOut = '';
    let transactions: NodeStatus['transactions'] = [];
    let transactionsNote = '';
    try {
      height = await nodeHeight(chain, datadir);
      const auth = loadCookie(cookiePath(datadir, chain));
      peers = peersFromRpc(await rpcCall(auth, 'getpeerinfo', [], { port: defaultRpcPort(chain) }).catch(() => []));
      const traffic = trafficFromRpc(await rpcCall(auth, 'getnettotals', [], { port: defaultRpcPort(chain) }).catch(() => null));
      trafficIn = traffic.inn;
      trafficOut = traffic.out;
      try {
        transactions = txsFromRpc(await rpcCall(auth, 'listtransactions', ['*', 8], { port: defaultRpcPort(chain) }));
        transactionsNote = txNote(true);
      } catch {
        transactionsNote = txNote(false);
      }
    } catch {
      height = -1;
    }
    const listening = height >= 0;
    if (listening && nodeSession.kind === 'idle') {
      nodeSession = { kind: 'attached', chain, datadir };
    }
    if (!listening && nodeSession.kind === 'attached' && nodeSession.chain === chain) {
      nodeSession = { kind: 'idle' };
    }
    const bin = resolveNodeBin(process.env, deps.here, deps.resourcesPath());
    const session = nodeSession.kind !== 'idle' && nodeSession.chain === chain ? nodeSession.kind : 'idle';
    const running = session !== 'idle';
    let secret = '';
    try {
      secret = loadCookie(cookiePath(datadir, chain)).password;
    } catch {
      secret = '';
    }
    return {
      ...IDLE_NODE_STATUS,
      session,
      chain: running ? chain : null,
      height: height >= 0 ? height : 0,
      running,
      lastError: nodeError,
      pid,
      command: nodeCommandLine(chain, datadir, owned, bin.kind === 'present' ? bin.path : ''),
      datadir,
      cpu: usage.cpu,
      rss: usage.rss,
      otherCount: countNamed('federationcoind', pid),
      ports: nodePortLines(chain),
      logTail: readLogTail(nodeDebugLogPath(datadir, chain), secret),
      peers,
      trafficIn,
      trafficOut,
      transactions,
      transactionsNote,
    };
  });

  ipcMain.handle('node:start', async (_e, raw: unknown) => {
    try {
      const { chain, datadir } = chainDatadir(raw, defaultDatadir());
      if (chain === 'main' && !MAIN_IS_LIVE) {
        throw new Error('MAIN is not live');
      }
      const height = await nodeHeight(chain, datadir).catch(() => -1);
      if (height >= 0) {
        nodeSession = { kind: 'attached', chain, datadir };
        nodeError = '';
        deps.emitLog('node', `attach ${chain} height ${height}`, 'ok');
        return { ok: true as const };
      }
      const bin = resolveNodeBin(process.env, deps.here, deps.resourcesPath());
      if (bin.kind !== 'present') {
        throw new Error('federationcoind addon was not included in this build');
      }
      const command = nodeCommand(bin.path, chain, datadir);
      const child = spawnNode(bin, chain, datadir);
      nodeSession = { kind: 'spawned', child, chain, command, datadir };
      nodeError = '';
      watchChild(child, 'node', () => {
        if (nodeSession.kind === 'spawned' && nodeSession.child === child) {
          nodeSession = { kind: 'idle' };
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

  ipcMain.handle('gateway:status', (_e, raw: unknown): GatewayStatus => {
    const chain = chainOf(raw);
    const owned = gatewaySession.kind === 'spawned' && gatewaySession.chain === chain ? gatewaySession : null;
    const pid = owned?.child.pid ?? null;
    const usage = samplePid(pid);
    const configPath = owned?.configPath || gatewayConfigPath(deps.userData(), chain, raw);
    const bin = resolveGatewayBin(process.env, deps.here, deps.resourcesPath());
    const command =
      owned?.command ||
      (bin.kind === 'present' ? gatewayCommand(bin.path, configPath) : '');
    return {
      session: owned ? 'spawned' : 'idle',
      running: !!owned,
      chain: owned?.chain ?? null,
      lastError: gatewayError,
      pid,
      command,
      configPath,
      cpu: usage.cpu,
      rss: usage.rss,
      otherCount: countNamed('datum_gateway', pid),
      ports: gatewayPorts(),
      logTail: gatewayLog.join('\n'),
    };
  });

  ipcMain.handle(
    'gateway:start',
    async (
      _e,
      opts: { chain: unknown; poolAddress: string; poolHost?: string; poolPubkey?: string; configPath?: string },
    ) => {
      try {
        const chain = parseChain(opts.chain);
        if (chain === 'main' && !MAIN_IS_LIVE) {
          throw new Error('MAIN is not live');
        }
        const datadir = defaultDatadir();
        const auth = loadCookie(cookiePath(datadir, chain));
        const bin = resolveGatewayBin(process.env, deps.here, deps.resourcesPath());
        const configPath = String(opts.configPath ?? '').trim() || join(deps.userData(), 'datum-gateway', `${chain}.json`);
        const command = bin.kind === 'present' ? gatewayCommand(bin.path, configPath) : '';
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
        gatewaySession = { kind: 'spawned', child, chain, command, configPath };
        gatewayError = '';
        gatewayLog = [];
        watchChild(child, 'gateway', () => {
          if (gatewaySession.kind === 'spawned' && gatewaySession.child === child) {
            gatewaySession = { kind: 'idle' };
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

  ipcMain.handle('prime:fetchKeys', async (_e, url: unknown) => {
    try {
      const text = await fetchHttpsText(String(url ?? ''));
      return { ok: true as const, text };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error };
    }
  });

  ipcMain.handle('wallet:load', (_e, chainRaw: unknown) => loadWalletBlob(deps.userData(), chainRaw));
  ipcMain.handle('wallet:save', (_e, chainRaw: unknown, blob: string) => {
    saveWalletBlob(deps.userData(), chainRaw, blob);
    return { ok: true as const };
  });

  function watchChild(child: ChildProcess, mode: 'node' | 'gateway', onExit: (code: number | null) => void): void {
    const onChunk = (chunk: string) => {
      const msg = chunk.trim();
      if (!msg) {
        return;
      }
      if (mode === 'node') {
        nodeError = msg.slice(0, 400);
      } else {
        gatewayError = msg.slice(0, 400);
        gatewayLog = pushRing(gatewayLog, msg);
      }
      deps.emitLog(mode, msg);
    };
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', onChunk);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', onChunk);
    child.on('exit', (code) => {
      if (mode === 'node') {
        nodeError = `exited ${code ?? 0}`;
      } else {
        gatewayError = `exited ${code ?? 0}`;
      }
      deps.emitLog(mode, `exit ${code ?? 0}`);
      onExit(code);
    });
  }
}

function chainDatadir(raw: unknown, fallback: string): { chain: MinerChain; datadir: string } {
  if (raw && typeof raw === 'object' && 'chain' in raw) {
    const rec = raw as { chain: unknown; datadir?: unknown };
    const datadir = String(rec.datadir ?? '').trim() || fallback;
    return { chain: parseChain(rec.chain), datadir };
  }
  return { chain: parseChain(raw), datadir: fallback };
}

function chainOf(raw: unknown): MinerChain {
  if (raw && typeof raw === 'object' && 'chain' in raw) {
    return parseChain((raw as { chain: unknown }).chain);
  }
  if (raw == null) {
    return 'testnet';
  }
  return parseChain(raw);
}

function nodeDatadir(chain: MinerChain, requested: string): string {
  if (nodeSession.kind !== 'idle' && nodeSession.chain === chain) {
    return nodeSession.datadir;
  }
  return requested;
}

function nodeCommandLine(
  chain: MinerChain,
  datadir: string,
  owned: Extract<NodeSession, { kind: 'spawned' }> | null,
  binPath: string,
): string {
  if (owned) {
    return owned.command;
  }
  if (!binPath || (chain === 'main' && !MAIN_IS_LIVE)) {
    return '';
  }
  return nodeCommand(binPath, chain, datadir);
}

function gatewayConfigPath(userData: string, chain: MinerChain, raw: unknown): string {
  if (raw && typeof raw === 'object' && 'configPath' in raw) {
    const path = String((raw as { configPath?: unknown }).configPath ?? '').trim();
    if (path) {
      return path;
    }
  }
  return join(userData, 'datum-gateway', `${chain}.json`);
}

async function nodeHeight(chain: MinerChain, datadir: string): Promise<number> {
  const auth = loadCookie(cookiePath(datadir, chain));
  const result = await rpcCall(auth, 'getblockcount', [], { port: defaultRpcPort(chain) });
  const n = typeof result === 'number' ? result : Number(result);
  if (!Number.isFinite(n)) {
    throw new Error('bad height');
  }
  return n;
}

function countNamed(comm: string, own: number | null): number {
  if (process.platform === 'linux') {
    return otherProcessCount(pidsWithCommIn('/proc', comm), own);
  }
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Process -Name '${comm}' -ErrorAction SilentlyContinue).Id`],
      { encoding: 'utf8', timeout: 4000 },
    );
    return otherProcessCount(pidsFromLines(String(r.stdout ?? '')), own);
  }
  return 0;
}

function samplePid(pid: number | null): { cpu: string; rss: string } {
  if (!pid) {
    return { cpu: '', rss: '' };
  }
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).CPU.ToString() + ' ' + (Get-Process -Id ${pid}).WorkingSet64`],
      { encoding: 'utf8', timeout: 4000 },
    );
    const parts = String(r.stdout ?? '').trim().split(/\s+/);
    const cpuSeconds = Number(parts[0]);
    const workingSet = Number(parts[1]);
    const now = Date.now();
    const parsed = usageFromWindowsLine(cpuSeconds, workingSet, winPrev.get(pid), now);
    winPrev.set(pid, parsed.sample);
    return parsed;
  }
  const now = Date.now();
  const usage = readUsage(pid, cpuPrev.get(pid), now);
  if (usage.sample) {
    cpuPrev.set(pid, usage.sample);
  }
  return usage;
}
