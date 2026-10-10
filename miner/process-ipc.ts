import { spawnSync, type ChildProcess } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import type { IpcMain } from 'electron';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { MAIN_IS_LIVE, parseChain, defaultRpcPort, type MinerChain } from './chain.js';
import { connectHostForReach, parseListenReach, privateIpv4, type ListenReach } from './listen-reach.js';
import { probeExtras, resolveGatewayBin, resolveNodeBin, type ExtrasProbe } from './extras.js';
import { gatewayCommand, spawnGateway, type GatewaySession } from './gateway-process.js';
import {
  canStopNode,
  ensureDir,
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
  firstForeignListener,
  gatewayPorts,
  listedDaemonPid,
  listenHolder,
  nodeDebugLogPath,
  preExistingProcessMessage,
  otherProcessCount,
  peersFromRpc,
  pidsFromLines,
  pidsWithCommIn,
  stickyPortTaken,
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
  connectHost: string;
  connectPort: number;
  configPath: string;
  cpu: string;
  rss: string;
  otherCount: number;
  ports: { label: string; port: number }[];
  logTail: string;
  portTaken: string;
  foreignPids: number[];
};

let nodeSession: NodeSession = { kind: 'idle' };
let gatewaySession: GatewaySession = { kind: 'idle' };
let nodeError = '';
let gatewayError = '';
let gatewayLog: string[] = [];
let nodeTaken = '';
let nodeTakenStreak = 0;
let gatewayTaken = '';
let gatewayTakenStreak = 0;
const cpuPrev = new Map<number, TickSample>();
const winPrev = new Map<number, { cpu: number; at: number }>();

export function takeSpawnedChildren(): ChildProcess[] {
  const children: ChildProcess[] = [];
  if (nodeSession.kind === 'spawned') {
    children.push(nodeSession.child);
  }
  if (gatewaySession.kind === 'spawned') {
    children.push(gatewaySession.child);
  }
  nodeSession = { kind: 'idle' };
  gatewaySession = { kind: 'idle' };
  gatewayLog = [];
  return children;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const GRACEFUL_SHUTDOWN_MS = 30_000;

function childStillRunning(child: ChildProcess, alive: (pid: number) => boolean): boolean {
  return child.exitCode == null && child.signalCode == null && !!child.pid && alive(child.pid);
}

export async function finishChildren(
  children: ChildProcess[],
  waitMs = GRACEFUL_SHUTDOWN_MS,
  alive: (pid: number) => boolean = pidAlive,
): Promise<void> {
  for (const child of children) {
    if (child.exitCode != null || child.signalCode != null) {
      continue;
    }
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && children.some((child) => childStillRunning(child, alive))) {
    const slice = Math.min(200, Math.max(0, deadline - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, slice));
  }
}

export function stopAllProcesses(): Promise<void> {
  return finishChildren(takeSpawnedChildren());
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
    const bin = resolveNodeBin(process.env, deps.here, deps.resourcesPath());
    const session = nodeSession.kind !== 'idle' && nodeSession.chain === chain ? nodeSession.kind : 'idle';
    const foreign = await foreignListener('node', nodeBindPorts(chain, rpcFrom(raw)), owned?.child.pid ?? null);
    const running = session !== 'idle';
    const reach = running ? nodeReach(chain) : null;
    const rpcOn = running && nodeRpc(chain);
    const connectHost = reach && rpcOn ? connectHostForReach(reach, privateIpv4(networkInterfaces())) : '';
    const connectPort = reach && rpcOn ? defaultRpcPort(chain) : 0;
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
      pid: pid ?? foreign?.pid ?? null,
      portTaken: rememberTaken('node', foreign?.message ?? ''),
      foreignPids: namedPids('federationcoind').filter((p) => p !== pid),
      command: nodeCommandLine(
        chain,
        datadir,
        owned,
        bin.kind === 'present' ? bin.path : '',
        listenFrom(raw),
        rpcFrom(raw),
      ),
      connectHost,
      connectPort,
      datadir,
      cpu: usage.cpu,
      rss: usage.rss,
      otherCount: countNamed('federationcoind', pid),
      ports: nodePortLines(chain),
      logTail: [!running && nodeError ? nodeError : '', readLogTail(nodeDebugLogPath(datadir, chain), secret)]
        .filter(Boolean)
        .join('\n'),
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
      const listenReach = listenFrom(raw);
      const rpc = rpcFrom(raw);
      const foreign = await foreignListener(
        'node',
        nodeBindPorts(chain, rpc),
        nodeSession.kind === 'spawned' ? nodeSession.child.pid ?? null : null,
      );
      if (foreign) {
        throw new Error(foreign.message);
      }
      const bin = resolveNodeBin(process.env, deps.here, deps.resourcesPath());
      if (bin.kind !== 'present') {
        throw new Error('federationcoind addon was not included in this build');
      }
      const command = nodeCommand(bin.path, chain, datadir, listenReach, rpc);
      ensureDir(datadir);
      const child = spawnNode(bin, chain, datadir, listenReach, rpc);
      nodeSession = { kind: 'spawned', child, chain, command, datadir, listenReach, rpc };
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

  ipcMain.handle('node:killForeign', async (_e, raw: unknown) => {
    try {
      await killForeign('node', raw);
      return { ok: true as const };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      deps.emitLog('node', error, 'error');
      return { ok: false as const, error };
    }
  });

  ipcMain.handle('gateway:killForeign', async (_e, raw: unknown) => {
    try {
      await killForeign('gateway', raw);
      return { ok: true as const };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      deps.emitLog('gateway', error, 'error');
      return { ok: false as const, error };
    }
  });

  ipcMain.handle('gateway:status', async (_e, raw: unknown): Promise<GatewayStatus> => {
    const chain = chainOf(raw);
    const owned = gatewaySession.kind === 'spawned' && gatewaySession.chain === chain ? gatewaySession : null;
    const pid = owned?.child.pid ?? null;
    const usage = samplePid(pid);
    const configPath = owned?.configPath || gatewayConfigPath(deps.userData(), chain, raw);
    const bin = resolveGatewayBin(process.env, deps.here, deps.resourcesPath());
    const command =
      owned?.command ||
      (bin.kind === 'present' ? gatewayCommand(bin.path, configPath) : '');
    const gatewayReach = owned?.listenReach ?? null;
    const foreign = await foreignListener(
      'gateway',
      gatewayPorts().map((line) => line.port),
      pid,
    );
    return {
      session: owned ? 'spawned' : 'idle',
      running: !!owned,
      chain: owned?.chain ?? null,
      lastError: gatewayError,
      pid: pid ?? foreign?.pid ?? null,
      portTaken: rememberTaken('gateway', foreign?.message ?? ''),
      foreignPids: namedPids('datum_gateway').filter((p) => p !== pid),
      command,
      connectHost: gatewayReach ? connectHostForReach(gatewayReach, privateIpv4(networkInterfaces())) : '',
      connectPort: gatewayReach ? 23334 : 0,
      configPath,
      cpu: usage.cpu,
      rss: usage.rss,
      otherCount: countNamed('datum_gateway', pid),
      ports: gatewayPorts(),
      logTail: [!owned && gatewayError ? gatewayError : '', gatewayLog.join('\n')].filter(Boolean).join('\n'),
    };
  });

  ipcMain.handle(
    'gateway:start',
    async (
      _e,
      opts: { chain: unknown; poolHost?: string; poolPubkey?: string; configPath?: string },
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
        ensureDir(dirname(configPath));
        const command = bin.kind === 'present' ? gatewayCommand(bin.path, configPath) : '';
        const listenReach = listenFrom(opts);
        const foreign = await foreignListener(
          'gateway',
          gatewayPorts().map((line) => line.port),
          gatewaySession.kind === 'spawned' ? gatewaySession.child.pid ?? null : null,
        );
        if (foreign) {
          throw new Error(foreign.message);
        }
        const child = spawnGateway(bin, {
          chain,
          rpcUrl: `http://127.0.0.1:${defaultRpcPort(chain)}`,
          rpcUser: auth.user,
          rpcPassword: auth.password,
          poolHost: String(opts.poolHost ?? '').trim(),
          poolPubkey: String(opts.poolPubkey ?? '').trim(),
          configPath,
          listenReach,
        });
        gatewaySession = { kind: 'spawned', child, chain, command, configPath, listenReach };
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
    let detail = '';
    const onChunk = (chunk: string) => {
      const msg = chunk.trim();
      if (!msg) {
        return;
      }
      detail = msg.slice(0, 400);
      if (mode === 'gateway') {
        gatewayLog = pushRing(gatewayLog, msg);
      }
      deps.emitLog(mode, msg);
    };
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', onChunk);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', onChunk);
    child.on('exit', (code) => {
      const failed = code !== 0 && code !== null;
      const msg = failed
        ? `Could not start ${mode}${detail ? `: ${detail}` : ` (exit ${code})`}`
        : `exit ${code ?? 0}`;
      if (mode === 'node') {
        nodeError = failed ? msg : '';
      } else {
        gatewayError = failed ? msg : '';
        if (failed) {
          gatewayLog = pushRing(gatewayLog, msg);
        }
      }
      deps.emitLog(mode, msg, failed ? 'error' : undefined);
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
  reach: ListenReach,
  rpc: boolean,
): string {
  if (owned) {
    return owned.command;
  }
  if (!binPath || (chain === 'main' && !MAIN_IS_LIVE)) {
    return '';
  }
  return nodeCommand(binPath, chain, datadir, reach, rpc);
}

function listenFrom(raw: unknown): ListenReach {
  if (raw && typeof raw === 'object' && 'listenReach' in raw) {
    return parseListenReach((raw as { listenReach?: unknown }).listenReach);
  }
  return 'computer';
}

function nodeReach(chain: MinerChain): ListenReach {
  if (nodeSession.kind === 'spawned' && nodeSession.chain === chain) {
    return nodeSession.listenReach;
  }
  return 'computer';
}

function rpcFrom(raw: unknown): boolean {
  if (raw && typeof raw === 'object' && 'rpc' in raw) {
    return (raw as { rpc?: unknown }).rpc !== false;
  }
  return true;
}

function nodeRpc(chain: MinerChain): boolean {
  if (nodeSession.kind === 'spawned' && nodeSession.chain === chain) {
    return nodeSession.rpc;
  }
  return true;
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

function namedPids(comm: string): number[] {
  if (process.platform === 'linux') {
    return pidsWithCommIn('/proc', comm);
  }
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Process -Name '${comm}' -ErrorAction SilentlyContinue).Id`],
      { encoding: 'utf8', timeout: 4000 },
    );
    return pidsFromLines(String(r.stdout ?? ''));
  }
  return [];
}

function countNamed(comm: string, own: number | null): number {
  return otherProcessCount(namedPids(comm), own);
}

function rememberTaken(kind: 'node' | 'gateway', current: string): string {
  if (kind === 'node') {
    const next = stickyPortTaken(current, nodeTaken, nodeTakenStreak);
    nodeTaken = next.message;
    nodeTakenStreak = next.streak;
    return next.message;
  }
  const next = stickyPortTaken(current, gatewayTaken, gatewayTakenStreak);
  gatewayTaken = next.message;
  gatewayTakenStreak = next.streak;
  return next.message;
}

function clearTaken(kind: 'node' | 'gateway'): void {
  if (kind === 'node') {
    nodeTaken = '';
    nodeTakenStreak = 2;
    return;
  }
  gatewayTaken = '';
  gatewayTakenStreak = 2;
}

function killPidFromRaw(raw: unknown): number {
  if (typeof raw === 'number') {
    return raw;
  }
  if (raw && typeof raw === 'object' && 'pid' in raw) {
    return Number((raw as { pid: unknown }).pid);
  }
  return Number(raw);
}

async function killForeign(kind: 'node' | 'gateway', raw: unknown): Promise<void> {
  const comm = kind === 'node' ? 'federationcoind' : 'datum_gateway';
  const listed = namedPids(comm);
  const pid = listedDaemonPid(killPidFromRaw(raw), listed);
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/F'], { encoding: 'utf8', timeout: 8000 });
    if (r.status !== 0) {
      throw new Error(String(r.stderr || r.stdout || `taskkill ${pid} failed`).trim());
    }
    clearTaken(kind);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  try {
    process.kill(pid, 0);
    process.kill(pid, 'SIGKILL');
  } catch {
    /* gone after TERM */
  }
  clearTaken(kind);
}

function nodeBindPorts(chain: MinerChain, rpc: boolean): number[] {
  return nodePortLines(chain)
    .filter((line) => line.label !== 'RPC' || rpc)
    .map((line) => line.port);
}

function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host: '127.0.0.1', port });
    const done = (listening: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', (err: NodeJS.ErrnoException) => {
      done(err.code !== 'ECONNREFUSED' && err.code !== 'ETIMEDOUT');
    });
  });
}

async function foreignListener(
  kind: 'node' | 'gateway',
  ports: number[],
  ownPid: number | null,
): Promise<{ message: string; pid: number | null } | null> {
  let holder = firstForeignListener(ports, ownPid, (port) => {
    const found = listenHolder(port);
    if (found && ownPid != null && found.pid == null) {
      return null;
    }
    return found;
  });
  if (!holder && ownPid == null && process.platform !== 'linux') {
    for (const port of ports) {
      if (await portAccepts(port)) {
        holder = { port, pid: null };
        break;
      }
    }
  }
  if (!holder) {
    return null;
  }
  return { message: preExistingProcessMessage(kind), pid: holder.pid };
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
