import { app, BrowserWindow, dialog, ipcMain, Menu, net } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { nextBackoff } from './backoff.js';
import { payoutScript } from './bech32.js';
import { MAIN_IS_LIVE, parseChain, type MinerChain } from './chain.js';
import { concat, toHex, u256ToHex, writeLe32 } from './bytes.js';
import { serializeBlock } from './coinbase.js';
import { buildJobFromGbt, fillFromSubmit, jobKey, type GbtResult, type Job } from './gbt.js';
import { logHistory, pushLog, redactSecret, type LogLine } from './log.js';
import { toastKindFromMessage, type ToastKind } from './toast.js';
import { datumWorkHeader, datumWorkRoot, headerHash, hashMeetsTarget, targetFromCompact, xorKeyMaskBytes } from './pow.js';
import { grindTargetForShare, specAfterShareAccept } from './difficulty.js';
import {
  cookiePath,
  cookiePathForDatadir,
  defaultDatadir,
  loadCookie,
  rpcCall,
  RPC_HOST,
  RPC_PORT,
  type RpcAuth,
} from './rpc.js';
import { nativeIdForStrategy, gpuExtraNonce2, listGpus, scanGpus, startGpuGrind, stopGpu } from './gpu.js';
import { parseGpuPicks, type GpuPick } from './gpu-pick.js';
import {
  IDLE_POOL_STATS,
  parsePoolStatsLine,
  poolArgv,
  resolvePoolCli,
  type PoolStartOpts,
  type PoolStats,
} from './pool.js';
import {
  parseMineTo,
  type MineTo,
  type MineToKind,
  type MinerStartOpts,
  type RpcAuthKind,
  type RpcConnect,
} from './mine-to.js';
import type { MinerInfo, MinerStats } from './preload.js';
import { registerProcessIpc, stopAllProcesses } from './process-ipc.js';
import { registryOrigin, registryRequestWithFetch, type RegistryFetchReq } from './registry-fetch.js';
import { StratumClient } from './stratum.js';
import type { WorkerInit, WorkerMsg } from './worker.js';

const here = dirname(fileURLToPath(import.meta.url));
const POLL_MS = 1500;

let win: BrowserWindow | null = null;
let logWin: BrowserWindow | null = null;
let running = false;
let stopRequested = false;
let workers: Worker[] = [];
let gen = 0;
let lastJobKey = '';
let hashesWindow = 0;
let hashesTotal = 0;
let hashrate = 0;
let lastRateAt = Date.now();
let accepted = 0;
let rejected = 0;
let lastError = '';
let lastHash = '';
let height = 0;
let status = 'idle';
let loopPromise: Promise<void> | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;
let sleepResolve: (() => void) | null = null;
let activeKind: MineToKind = 'node';
let activeChain: MinerChain | null = null;
let protocolClient: { close(): void } | null = null;
let lastPoolOpts: PoolStartOpts | null = null;
let extraNonce1: Uint8Array = new Uint8Array(4);
let rpcHost = RPC_HOST;
let rpcPort = RPC_PORT;
let activeCookieFile = '';
let cookieAuth: RpcAuth | null = null;
let rpcAuthKind: RpcAuthKind = 'cookie';
let cookieSecret = '';
let stratumSecret = '';
let activeGpuPicks: GpuPick[] = [];
let poolChild: ChildProcess | null = null;
let poolStatsState: PoolStats = { ...IDLE_POOL_STATS };

function minerLink(runningNow: boolean, statusNow: string): MinerStats['link'] {
  if (!runningNow) {
    return 'idle';
  }
  const s = statusNow.toLowerCase();
  if (s.includes('reconnect') || s === 'disconnected' || s.startsWith('connecting')) {
    return 'down';
  }
  return 'up';
}

function stats(): MinerStats {
  return {
    running,
    chain: running ? activeChain : null,
    hashrate,
    height,
    hashes: hashesTotal,
    accepted,
    rejected,
    lastError: safeText(lastError),
    lastHash,
    status,
    link: minerLink(running, status),
  };
}

function safeText(s: string): string {
  let out = s;
  if (cookieSecret) {
    out = redactSecret(out, cookieSecret);
  }
  if (stratumSecret) {
    out = redactSecret(out, stratumSecret);
  }
  return out;
}

function emitStats(): void {
  win?.webContents.send('miner:stats', stats());
}

function emitLog(mode: string, message: string, toast: false | ToastKind = false): LogLine {
  const line = pushLog(mode, safeText(message));
  const payload = { ...line };
  win?.webContents.send('miner:log', payload);
  logWin?.webContents.send('miner:log', payload);
  if (toast) {
    win?.webContents.send('miner:toast', { message: payload.message, kind: toast });
  }
  return line;
}

function sendToast(message: string, kind: ToastKind): void {
  win?.webContents.send('miner:toast', { message, kind });
}

function emitPoolStats(): void {
  win?.webContents.send('pool:stats', poolStatsState);
}

function stopPoolChild(): void {
  if (poolChild) {
    poolChild.kill('SIGTERM');
    poolChild = null;
  }
  lastPoolOpts = null;
  poolStatsState = { ...IDLE_POOL_STATS, status: 'stopped' };
  emitPoolStats();
}

function killWorkers(): void {
  stopGpu();
  gpuJobSpec = null;
  win?.webContents.send('miner:webgpu-stop', { gen });
  for (const w of workers) {
    w.terminate();
  }
  workers = [];
}

function cancelSleep(): void {
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
  const r = sleepResolve;
  sleepResolve = null;
  r?.();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    sleepResolve = () => resolve();
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      const r = sleepResolve;
      sleepResolve = null;
      r?.();
    }, ms);
  });
}

function noteHashes(n: number): void {
  hashesWindow += n;
  hashesTotal += n;
  const now = Date.now();
  const dt = (now - lastRateAt) / 1000;
  if (dt >= 1) {
    hashrate = hashesWindow / dt;
    hashesWindow = 0;
    lastRateAt = now;
    emitStats();
  }
}

type GrindSpec = {
  coinb1: Uint8Array;
  prevHidden: Uint8Array;
  ntime8: Uint8Array;
  target: Uint8Array;
  xorKey: Uint8Array;
  xorClear: number;
  extraNonce1: Uint8Array;
  height: number;
  onFound: (msg: Extract<WorkerMsg, { type: 'found' }>, extraNonce12: Uint8Array) => void;
};

let gpuJobSpec: GrindSpec | null = null;

function huntBlockAfterShare(lastSpec: GrindSpec | null, nBits: number, threads: number): GrindSpec | null {
  if (!lastSpec || !running || stopRequested) {
    return null;
  }
  const next = specAfterShareAccept(lastSpec, nBits);
  if (!next) {
    return null;
  }
  spawnWorkers(next, threads);
  spawnGpu(next, next.target);
  status = 'hunting block';
  emitStats();
  return next;
}

function spawnWorkers(spec: GrindSpec, threads: number): void {
  killWorkers();
  gen++;
  const target = spec.target;
  if (target.length !== 32) {
    lastError = 'bad target';
    emitLog(activeKind, lastError, 'error');
    emitStats();
    return;
  }
  const n = Math.max(1, Math.min(64, threads | 0));
  status = `mining height ${spec.height}`;
  height = spec.height;
  emitStats();
  for (let i = 0; i < n; i++) {
    const extraNonce2 = new Uint8Array(8);
    writeLe32(extraNonce2, 0, i);
    const extraNonce12 = concat(spec.extraNonce1, extraNonce2);
    const root = datumWorkRoot(spec.coinb1, extraNonce12);
    const nonce8 = new Uint8Array(8);
    const work = datumWorkHeader(spec.prevHidden, nonce8, spec.ntime8, root);
    const init: WorkerInit = {
      work,
      target,
      xorKey: spec.xorKey,
      xorClear: spec.xorClear,
      start: i,
      stride: n,
      gen,
      extraNonce2,
    };
    const w = new Worker(join(here, 'worker.js'), { workerData: init });
    const myGen = gen;
    w.on('message', (msg: WorkerMsg) => {
      if (msg.gen !== myGen) {
        return;
      }
      if (msg.type === 'progress') {
        noteHashes(msg.hashes);
        return;
      }
      noteHashes(msg.hashes);
      spec.onFound(msg, concat(spec.extraNonce1, msg.extraNonce2));
    });
    w.on('error', (err) => {
      lastError = err.message;
      emitLog(activeKind, lastError, 'error');
      emitStats();
    });
    workers.push(w);
  }
}

function spawnGpu(spec: GrindSpec, target: Uint8Array): void {
  const picks = activeGpuPicks;
  if (picks.length === 0) {
    return;
  }
  gpuJobSpec = spec;
  const devices = listGpus();
  const myGen = gen;
  for (let g = 0; g < picks.length; g++) {
    const pick = picks[g]!;
    const extraNonce2 = gpuExtraNonce2(g);
    const extraNonce12 = concat(spec.extraNonce1, extraNonce2);
    const root = datumWorkRoot(spec.coinb1, extraNonce12);
    const nonce8 = new Uint8Array(8);
    const work = datumWorkHeader(spec.prevHidden, nonce8, spec.ntime8, root);
    if (pick.strategy.kind === 'webgpu') {
      const mask = xorKeyMaskBytes(spec.xorKey, spec.xorClear);
      win?.webContents.send('miner:webgpu-job', {
        gen: myGen,
        label: pick.adapter,
        work: Array.from(work),
        target: Array.from(target),
        mask: Array.from(mask),
        extraNonce2: Array.from(extraNonce2),
      });
      continue;
    }
    const id = nativeIdForStrategy(devices, pick.strategy);
    if (!id) {
      emitLog(activeKind, `gpu: skipped missing device ${pick.strategy.kind}`);
      continue;
    }
    const started = startGpuGrind({
      deviceId: id,
      work,
      target,
      xorKey: spec.xorKey,
      xorClear: spec.xorClear,
      extraNonce2,
      gen: myGen,
      onProgress: (n) => {
        if (myGen === gen) {
          noteHashes(n);
        }
      },
      onFound: (msg) => {
        if (msg && myGen === gen) {
          spec.onFound(
            {
              type: 'found',
              nonce: msg.nonce,
              nonce2: msg.nonce2,
              ntime8: spec.ntime8,
              extraNonce2,
              hashes: msg.hashes,
              gen: myGen,
            },
            extraNonce12,
          );
        }
      },
      onLog: (message) => emitLog(activeKind, message, toastKindFromMessage(message)),
    });
    if (!started) {
      emitLog(activeKind, `gpu: start failed ${id}`, 'error');
    }
  }
}

function authCached(fresh?: RpcAuth): RpcAuth {
  if (fresh) {
    cookieAuth = fresh;
  }
  if (!cookieAuth) {
    if (rpcAuthKind === 'userpass') {
      throw new Error('RPC username/password is not set');
    }
    cookieAuth = loadCookie(activeCookieFile || cookiePath());
  }
  return cookieAuth;
}

async function onRpcFound(job: Job, msg: Extract<WorkerMsg, { type: 'found' }>, extraNonce12: Uint8Array): Promise<void> {
  const nonce8 = new Uint8Array(8);
  writeLe32(nonce8, 0, msg.nonce);
  writeLe32(nonce8, 4, msg.nonce2);
  const hdr = fillFromSubmit(job, extraNonce12, msg.ntime8, nonce8);
  const hash = headerHash(hdr);
  lastHash = u256ToHex(hash);
  const target = targetFromCompact(job.hdr.nBits);
  if (!target || !hashMeetsTarget(hash, target)) {
    rejected++;
    lastError = 'high-hash after reconstruct';
    emitLog('rpc', lastError, 'error');
    emitStats();
    return;
  }
  try {
    const block = serializeBlock(hdr, job.coinbaseWit, job.txs);
    const result = await rpcCall(authCached(), 'submitblock', [toHex(block)], {
      host: rpcHost,
      port: rpcPort,
    });
    if (result === null || result === undefined || result === '') {
      accepted++;
      lastError = '';
      status = `accepted ${lastHash.slice(0, 16)}…`;
      lastJobKey = '';
      killWorkers();
    } else {
      rejected++;
      lastError = String(result);
      emitLog('rpc', lastError, 'error');
    }
  } catch (e) {
    rejected++;
    lastError = e instanceof Error ? e.message : String(e);
    emitLog('rpc', lastError, 'error');
  }
  emitStats();
}

async function mineRpcLoop(payout: Uint8Array, threads: number): Promise<void> {
  let delay = 0;
  lastJobKey = '';
  while (running && !stopRequested) {
    try {
      if (rpcAuthKind === 'cookie') {
        cookieAuth = loadCookie(activeCookieFile || cookiePath());
      }
      const raw = (await rpcCall(authCached(), 'getblocktemplate', [{ rules: ['segwit', 'blake2b'] }], {
        host: rpcHost,
        port: rpcPort,
      })) as GbtResult;
      delay = 0;
      const key = jobKey(raw);
      if (key !== lastJobKey) {
        const job = buildJobFromGbt(raw, payout);
        lastJobKey = key;
        lastError = '';
        const spec = {
            coinb1: job.coinb1,
            prevHidden: job.prevHidden,
            ntime8: job.ntime8,
            target: targetFromCompact(job.hdr.nBits) ?? new Uint8Array(32),
            xorKey: job.hdr.xorKey,
            xorClear: job.hdr.xorKeyMaskClearBits,
            extraNonce1,
            height: job.hdr.height > 0 ? job.hdr.height - 1 : 0,
            onFound: (msg: Extract<WorkerMsg, { type: 'found' }>, en12: Uint8Array) => {
              void onRpcFound(job, msg, en12);
            },
          };
        if (spec.target.every((b) => b === 0)) {
          lastError = 'bad nBits';
          emitLog('rpc', lastError, 'error');
          emitStats();
        } else {
          spawnWorkers(spec, threads);
          spawnGpu(spec, spec.target);
        }
      }
      await sleep(POLL_MS);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      killWorkers();
      delay = nextBackoff(delay);
      const waitSec = Math.round(delay / 1000);
      status = `reconnecting in ${waitSec}s`;
      emitLog('rpc', `${lastError}; retry in ${waitSec}s`, 'error');
      emitStats();
      await sleep(delay);
    }
  }
}

function mineStratumLoop(opts: { host: string; port: number; worker: string; password: string; threads: number }): Promise<void> {
  return new Promise((resolve) => {
    let delay = 0;
    let finished = false;

    const done = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      protocolClient?.close();
      protocolClient = null;
      resolve();
    };

    const connect = (): void => {
      if (!running || stopRequested) {
        done();
        return;
      }
      extraNonce1 = new Uint8Array(4);
      let shareDiff = 1n;
      let lastSpec: GrindSpec | null = null;
      let lastNBits = 0;
      let poolHeight = 0;
      const client = new StratumClient(opts.host, opts.port, opts.worker, opts.password, {
        onSubscribed: (sub) => {
          extraNonce1 = new Uint8Array(sub.extraNonce1);
          delay = 0;
        },
        onDifficulty: (diff) => {
          shareDiff = BigInt(Math.max(1, Math.floor(diff)));
        },
        onAuthorized: () => {
          delay = 0;
          status = `authorized ${opts.worker}`;
          emitStats();
        },
        onJobIgnored: (reason) => {
          lastError = reason;
          status = reason;
          emitLog('stratum', reason, 'error');
          emitStats();
        },
        onPoolStats: (stats) => {
          poolHeight = stats.height;
          height = stats.height;
          if (stats.status) {
            poolStatsState = {
              ...poolStatsState,
              running: true,
              height: stats.height,
              workers: stats.workers,
              status: stats.status,
            };
            emitPoolStats();
          }
          emitStats();
        },
        onNotify: (job) => {
          delay = 0;
          lastError = '';
          const target = grindTargetForShare(job.nBits, shareDiff);
          if (!target) {
            lastError = 'bad nBits';
            emitLog('stratum', lastError, 'error');
            emitStats();
            return;
          }
          const spec: GrindSpec = {
              coinb1: job.coinb1,
              prevHidden: job.prevHidden,
              ntime8: job.ntime8,
              target,
              xorKey: new Uint8Array(16),
              xorClear: 0,
              extraNonce1,
              height: poolHeight,
              onFound: (msg: Extract<WorkerMsg, { type: 'found' }>, _en12: Uint8Array) => {
                const nonce8 = new Uint8Array(8);
                writeLe32(nonce8, 0, msg.nonce);
                writeLe32(nonce8, 4, msg.nonce2);
                lastHash = toHex(nonce8);
                client.submit(job.jobId, msg.extraNonce2, msg.ntime8, nonce8);
              },
            };
          lastSpec = spec;
          lastNBits = job.nBits;
          spawnWorkers(spec, opts.threads);
          spawnGpu(spec, spec.target);
        },
        onSubmitResult: (ok, error) => {
          if (ok) {
            accepted++;
            lastError = '';
            status = 'share accepted';
            const next = huntBlockAfterShare(lastSpec, lastNBits, opts.threads);
            if (next) {
              lastSpec = next;
            }
          } else {
            rejected++;
            lastError = error ?? 'Share rejected';
            emitLog('stratum', lastError, 'error');
          }
          emitStats();
        },
        onClose: (reason) => {
          if (protocolClient !== client) {
            return;
          }
          protocolClient = null;
          killWorkers();
          if (!running || stopRequested || finished) {
            done();
            return;
          }
          lastError = reason;
          delay = nextBackoff(delay);
          const waitSec = Math.round(delay / 1000);
          status = `reconnecting in ${waitSec}s`;
          emitLog('stratum', `${reason}; retry in ${waitSec}s`, 'error');
          emitStats();
          void sleep(delay).then(() => {
            if (!running || stopRequested || finished) {
              done();
              return;
            }
            connect();
          });
        },
      });
      protocolClient = client;
      status = `connecting ${opts.host}:${opts.port}`;
      emitStats();
      client.connect();
    };

    connect();
  });
}

let parsedMineTo: MineTo | null = null;

function bindNodeRpc(rpc: RpcConnect, chain: MinerChain): void {
  rpcHost = rpc.host;
  rpcPort = rpc.port;
  rpcAuthKind = rpc.auth.kind;
  if (rpc.auth.kind === 'userpass') {
    const user = rpc.auth.user.trim();
    if (!user) {
      throw new Error('RPC username is empty');
    }
    cookieAuth = { user, password: rpc.auth.password };
    cookieSecret = rpc.auth.password;
    activeCookieFile = '';
    return;
  }
  const datadir = rpc.auth.datadir.trim() || defaultDatadir();
  activeCookieFile = cookiePathForDatadir(datadir, chain);
  cookieAuth = loadCookie(activeCookieFile);
  cookieSecret = cookieAuth.password;
}

function prepareStart(opts: MinerStartOpts): void {
  activeChain = parseChain(opts.chain);
  const mineTo = parseMineTo(opts.mineTo, activeChain);
  parsedMineTo = mineTo;
  activeKind = mineTo.kind;
  cookieSecret = '';
  stratumSecret = '';
  rpcAuthKind = 'cookie';
  activeGpuPicks = parseGpuPicks(opts.gpus);
  if (mineTo.kind === 'node') {
    payoutScript(mineTo.payout, activeChain);
    bindNodeRpc(mineTo.rpc, activeChain);
    return;
  }
  if (mineTo.kind === 'stratum') {
    stratumSecret = mineTo.stratum.password;
  }
}

async function runMiner(opts: MinerStartOpts): Promise<void> {
  const chain = parseChain(opts.chain);
  const mineTo = parsedMineTo ?? parseMineTo(opts.mineTo, chain);
  extraNonce1 = new Uint8Array(4);
  switch (mineTo.kind) {
    case 'node':
      await mineRpcLoop(payoutScript(mineTo.payout, chain), opts.threads);
      return;
    case 'stratum':
      await mineStratumLoop({ ...mineTo.stratum, threads: opts.threads });
      return;
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#111318',
    icon: join(here, 'icon.png'),
    webPreferences: {
      preload: join(here, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const index = join(here, '../dist/renderer/browser/index.html');
  void win.loadFile(index);
  win.on('closed', () => {
    win = null;
  });
}

function openLogWindow(): void {
  if (logWin) {
    logWin.focus();
    return;
  }
  logWin = new BrowserWindow({
    width: 720,
    height: 480,
    backgroundColor: '#111318',
    title: 'Error log',
    icon: join(here, 'icon.png'),
    webPreferences: {
      preload: join(here, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  void logWin.loadFile(join(here, 'log.html'));
  logWin.on('closed', () => {
    logWin = null;
  });
}

function installMenu(): void {
  const help: Electron.MenuItemConstructorOptions = {
    label: 'Help',
    role: 'help',
    submenu: [{ label: 'Error log', click: () => openLogWindow() }],
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      help,
    ]),
  );
}

ipcMain.handle('miner:pickDatadir', async () => {
  const opts = {
    title: 'Node data directory',
    defaultPath: defaultDatadir(),
    properties: ['openDirectory' as const],
  };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (r.canceled || !r.filePaths[0]) {
    return null;
  }
  return r.filePaths[0];
});

ipcMain.handle('miner:info', (): MinerInfo => {
  const datadir = defaultDatadir();
  return {
    cookiePath: cookiePath(datadir),
    datadir,
    rpc: `${RPC_HOST}:${RPC_PORT}`,
    electron: true,
    defaultThreads: availableParallelism(),
  };
});

ipcMain.handle('miner:logHistory', (): LogLine[] => logHistory());

ipcMain.handle('miner:gpus', () => scanGpus());

ipcMain.handle('miner:webgpu-found', (_e, msg: { gen: number; nonce: number; nonce2: number; hashes: number; extraNonce2: number[] }) => {
  const spec = gpuJobSpec;
  if (!spec || msg.gen !== gen) {
    return;
  }
  const extraNonce2 = Uint8Array.from(msg.extraNonce2 ?? []);
  spec.onFound(
    {
      type: 'found',
      nonce: msg.nonce,
      nonce2: msg.nonce2,
      ntime8: spec.ntime8,
      extraNonce2,
      hashes: msg.hashes,
      gen: msg.gen,
    },
    concat(spec.extraNonce1, extraNonce2),
  );
});

ipcMain.handle('miner:webgpu-progress', (_e, msg: { gen: number; hashes: number }) => {
  if (msg.gen !== gen) {
    return;
  }
  noteHashes(msg.hashes);
});

ipcMain.handle('miner:webgpu-log', (_e, message: string) => {
  emitLog(activeKind, String(message ?? ''), toastKindFromMessage(String(message ?? '')));
});

ipcMain.handle('pool:start', async (_e, opts: PoolStartOpts) => {
  try {
    const chain = parseChain(opts.chain);
    if (chain === 'main' && !MAIN_IS_LIVE) {
      sendToast('MAIN is not live', 'error');
    }
    const args = poolArgv(opts);
    const cli = resolvePoolCli(process.env, here, process.resourcesPath);
    if (!cli) {
      throw new Error('federation-pool CLI not found (build ../federation-pool or set FEDERATION_POOL_CLI)');
    }
    stopPoolChild();
    lastPoolOpts = opts;
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    poolChild = child;
    poolStatsState = {
      ...IDLE_POOL_STATS,
      running: true,
      chain,
      status: 'starting',
      stratumHost: opts.stratumHost,
      stratumPort: opts.stratumPort,
      datumHost: opts.datumHost,
      datumPort: opts.datumPort,
    };
    emitPoolStats();
    emitLog('pool', `start ${chain} ${cli}`);
    let buf = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      while (true) {
        const nl = buf.indexOf('\n');
        if (nl < 0) {
          break;
        }
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const parsed = parsePoolStatsLine(line);
        if (parsed) {
          poolStatsState = parsed;
          emitPoolStats();
        }
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      const msg = chunk.trim();
      if (msg) {
        poolStatsState = { ...poolStatsState, lastError: msg };
        emitLog('pool', msg, toastKindFromMessage(msg));
        emitPoolStats();
      }
    });
    child.on('exit', (code) => {
      if (poolChild !== child) {
        return;
      }
      poolChild = null;
      lastPoolOpts = null;
      poolStatsState = {
        ...IDLE_POOL_STATS,
        lastError: code ? `pool exit ${code}` : poolStatsState.lastError,
        status: 'stopped',
      };
      emitPoolStats();
      emitLog('pool', `stopped${code ? ` (${code})` : ''}`);
    });
    return { ok: true as const };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    emitLog('pool', error, 'error');
    return { ok: false as const, error };
  }
});

ipcMain.handle('pool:stop', async () => {
  emitLog('pool', 'stop');
  stopPoolChild();
});

ipcMain.handle('pool:refresh', () => {
  if (!poolChild?.stdin) {
    return { ok: false as const, error: 'pool not running' };
  }
  poolChild.stdin.write('REFRESH\n');
  emitLog('pool', 'refresh job');
  return { ok: true as const };
});

ipcMain.handle('registry:request', async (_e, req: RegistryFetchReq) => {
  const chain = parseChain(req.chain);
  if (chain === 'main' && !MAIN_IS_LIVE) {
    throw new Error('Main is not live');
  }
  return registryRequestWithFetch((url, init) => net.fetch(url, init), registryOrigin(), { ...req, chain });
});

ipcMain.handle(
  'miner:start',
  async (_e, opts: MinerStartOpts) => {
    try {
      const chain = parseChain(opts.chain);
      if (chain === 'main' && !MAIN_IS_LIVE) {
        sendToast('MAIN is not live', 'error');
        return { ok: false as const, error: 'MAIN is not live' };
      }
      if (running) {
        stopRequested = true;
        protocolClient?.close();
        cancelSleep();
        await loopPromise;
      }
      prepareStart(opts);
      stopRequested = false;
      running = true;
      status = 'starting';
      hashesTotal = 0;
      hashesWindow = 0;
      hashrate = 0;
      accepted = 0;
      rejected = 0;
      lastHash = '';
      lastRateAt = Date.now();
      lastError = '';
      emitStats();
      emitLog(activeKind, `start ${activeChain} ${activeKind}`, 'ok');
      loopPromise = runMiner(opts)
        .catch((e) => {
          lastError = e instanceof Error ? e.message : String(e);
          emitLog(activeKind, lastError, 'error');
        })
        .finally(() => {
          killWorkers();
          running = false;
          status = 'stopped';
          emitStats();
        });
      return { ok: true as const };
    } catch (e) {
      running = false;
      lastError = e instanceof Error ? e.message : String(e);
      emitLog(activeKind, lastError, 'error');
      emitStats();
      return { ok: false as const, error: lastError };
    }
  },
);

registerProcessIpc(ipcMain, {
  here,
  resourcesPath: () => process.resourcesPath,
  userData: () => app.getPath('userData'),
  emitLog: (mode, message, kind) => {
    emitLog(mode, message, kind ?? false);
  },
});

ipcMain.handle('miner:stop', async () => {
  stopRequested = true;
  running = false;
  cancelSleep();
  protocolClient?.close();
  killWorkers();
  status = 'stopped';
  emitLog(activeKind, 'stop');
  emitStats();
});

app.whenReady().then(() => {
  installMenu();
  createWindow();
  setInterval(() => {
    if (running) {
      emitStats();
    }
  }, 1000);
});

app.on('window-all-closed', () => {
  stopRequested = true;
  cancelSleep();
  protocolClient?.close();
  killWorkers();
  stopPoolChild();
  stopAllProcesses();
  app.quit();
});
