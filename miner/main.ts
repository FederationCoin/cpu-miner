import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { nextBackoff } from './backoff.js';
import { payoutScript } from './bech32.js';
import { MAIN_IS_LIVE, defaultRpcPort, parseChain, STRATUM_PORT_DEFAULT, type MinerChain } from './chain.js';
import { concat, toHex, u256ToHex, writeLe32 } from './bytes.js';
import { serializeBlock } from './coinbase.js';
import { buildJobFromGbt, fillFromSubmit, jobKey, type GbtResult, type Job } from './gbt.js';
import { logHistory, pushLog, redactSecret, type LogLine } from './log.js';
import { datumWorkHeader, datumWorkRoot, headerHash, hashMeetsTarget, targetFromCompact } from './pow.js';
import {
  cookiePath,
  cookiePathForDatadir,
  defaultDatadir,
  loadCookie,
  parseHost,
  parsePort,
  rpcCall,
  RPC_HOST,
  RPC_PORT,
  type RpcAuth,
} from './rpc.js';
import { gpuExtraNonce2, listGpus, scanGpus, startGpuGrind, stopGpu } from './gpu.js';
import {
  IDLE_POOL_STATS,
  parsePoolStatsLine,
  poolArgv,
  resolvePoolCli,
  type PoolStartOpts,
  type PoolStats,
} from './pool.js';
import { StratumClient } from './stratum.js';
import type { MinerInfo, MinerMode, MinerStartOpts, MinerStats } from './preload.js';
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
let activeMode: MinerMode = 'rpc';
let activeChain: MinerChain | null = null;
let stratumClient: StratumClient | null = null;
let extraNonce1: Uint8Array = new Uint8Array(4);
let rpcHost = RPC_HOST;
let rpcPort = RPC_PORT;
let activeCookieFile = '';
let cookieAuth: RpcAuth | null = null;
let cookieSecret = '';
let stratumSecret = '';
let activeGpuIds: string[] = [];
let poolChild: ChildProcess | null = null;
let poolStatsState: PoolStats = { ...IDLE_POOL_STATS };

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

function emitLog(mode: string, message: string, toast = false): LogLine {
  const line = pushLog(mode, safeText(message));
  const payload = { ...line };
  win?.webContents.send('miner:log', payload);
  logWin?.webContents.send('miner:log', payload);
  if (toast) {
    win?.webContents.send('miner:toast', payload.message);
  }
  return line;
}

function emitPoolStats(): void {
  win?.webContents.send('pool:stats', poolStatsState);
}

function stopPoolChild(): void {
  if (poolChild) {
    poolChild.kill('SIGTERM');
    poolChild = null;
  }
  poolStatsState = { ...IDLE_POOL_STATS, status: 'stopped' };
  emitPoolStats();
}

function killWorkers(): void {
  stopGpu();
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
  nBits: number;
  xorKey: Uint8Array;
  xorClear: number;
  extraNonce1: Uint8Array;
  height: number;
  onFound: (msg: Extract<WorkerMsg, { type: 'found' }>, extraNonce12: Uint8Array) => void;
};

function spawnWorkers(spec: GrindSpec, threads: number): void {
  killWorkers();
  gen++;
  const target = targetFromCompact(spec.nBits);
  if (!target) {
    lastError = 'bad nBits';
    emitLog(activeMode, lastError, true);
    emitStats();
    return;
  }
  const n = Math.max(1, Math.min(64, threads | 0));
  status = spec.height ? `mining height ${spec.height}` : 'mining';
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
      emitLog(activeMode, lastError, true);
      emitStats();
    });
    workers.push(w);
  }
}

function spawnGpu(spec: GrindSpec, target: Uint8Array): void {
  const ids = activeGpuIds.filter((id) => id.trim());
  if (ids.length === 0) {
    return;
  }
  const known = new Set(listGpus().map((d) => d.id));
  const myGen = gen;
  for (let g = 0; g < ids.length; g++) {
    const id = ids[g]!;
    if (!known.has(id)) {
      emitLog(activeMode, `gpu: skipped missing device ${id}`);
      continue;
    }
    const extraNonce2 = gpuExtraNonce2(g);
    const extraNonce12 = concat(spec.extraNonce1, extraNonce2);
    const root = datumWorkRoot(spec.coinb1, extraNonce12);
    const nonce8 = new Uint8Array(8);
    const work = datumWorkHeader(spec.prevHidden, nonce8, spec.ntime8, root);
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
      onLog: (message) => emitLog(activeMode, message, true),
    });
    if (started) {
      emitLog(activeMode, `gpu: hashing on ${id}`);
    }
  }
}

function authCached(fresh?: RpcAuth): RpcAuth {
  if (fresh) {
    cookieAuth = fresh;
  }
  if (!cookieAuth) {
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
    emitLog('rpc', lastError, true);
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
      emitLog('rpc', lastError, true);
    }
  } catch (e) {
    rejected++;
    lastError = e instanceof Error ? e.message : String(e);
    emitLog('rpc', lastError, true);
  }
  emitStats();
}

async function mineRpcLoop(payout: Uint8Array, threads: number): Promise<void> {
  let delay = 0;
  lastJobKey = '';
  while (running && !stopRequested) {
    try {
      cookieAuth = loadCookie(activeCookieFile || cookiePath());
      const raw = (await rpcCall(cookieAuth, 'getblocktemplate', [{ rules: ['segwit', 'blake2b'] }], {
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
            nBits: job.hdr.nBits,
            xorKey: job.hdr.xorKey,
            xorClear: job.hdr.xorKeyMaskClearBits,
            extraNonce1,
            height: job.hdr.height,
            onFound: (msg: Extract<WorkerMsg, { type: 'found' }>, en12: Uint8Array) => {
              void onRpcFound(job, msg, en12);
            },
          };
        spawnWorkers(spec, threads);
        const gpuTarget = targetFromCompact(spec.nBits);
        if (gpuTarget) {
          spawnGpu(spec, gpuTarget);
        }
      }
      await sleep(POLL_MS);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      killWorkers();
      delay = nextBackoff(delay);
      const waitSec = Math.round(delay / 1000);
      status = `reconnecting in ${waitSec}s`;
      emitLog('rpc', `${lastError}; retry in ${waitSec}s`, true);
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
      stratumClient?.close();
      stratumClient = null;
      resolve();
    };

    const connect = (): void => {
      if (!running || stopRequested) {
        done();
        return;
      }
      extraNonce1 = new Uint8Array(4);
      const client = new StratumClient(opts.host, opts.port, opts.worker, opts.password, {
        onSubscribed: (sub) => {
          extraNonce1 = new Uint8Array(sub.extraNonce1);
          delay = 0;
        },
        onAuthorized: () => {
          delay = 0;
          status = `authorized ${opts.worker}`;
          emitStats();
        },
        onNotify: (job) => {
          delay = 0;
          lastError = '';
          const spec = {
              coinb1: job.coinb1,
              prevHidden: job.prevHidden,
              ntime8: job.ntime8,
              nBits: job.nBits,
              xorKey: new Uint8Array(16),
              xorClear: 0,
              extraNonce1,
              height: 0,
              onFound: (msg: Extract<WorkerMsg, { type: 'found' }>, _en12: Uint8Array) => {
                const nonce8 = new Uint8Array(8);
                writeLe32(nonce8, 0, msg.nonce);
                writeLe32(nonce8, 4, msg.nonce2);
                lastHash = toHex(nonce8);
                client.submit(job.jobId, msg.extraNonce2, msg.ntime8, nonce8);
              },
            };
          spawnWorkers(spec, opts.threads);
          const gpuTarget = targetFromCompact(spec.nBits);
          if (gpuTarget) {
            spawnGpu(spec, gpuTarget);
          }
        },
        onSubmitResult: (ok, error) => {
          if (ok) {
            accepted++;
            lastError = '';
            status = 'share accepted';
            killWorkers();
          } else {
            rejected++;
            lastError = error ?? 'share rejected';
            emitLog('stratum', lastError, true);
          }
          emitStats();
        },
        onClose: (reason) => {
          if (stratumClient !== client) {
            return;
          }
          stratumClient = null;
          killWorkers();
          if (!running || stopRequested || finished) {
            done();
            return;
          }
          lastError = reason;
          delay = nextBackoff(delay);
          const waitSec = Math.round(delay / 1000);
          status = `reconnecting in ${waitSec}s`;
          emitLog('stratum', `${reason}; retry in ${waitSec}s`, true);
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
      stratumClient = client;
      status = `connecting ${opts.host}:${opts.port}`;
      emitStats();
      client.connect();
    };

    connect();
  });
}

function prepareStart(opts: MinerStartOpts): void {
  activeChain = parseChain(opts.chain);
  activeMode = opts.mode === 'stratum' ? 'stratum' : 'rpc';
  cookieSecret = '';
  stratumSecret = '';
  activeGpuIds = (opts.gpuIds ?? []).filter((id) => id.trim());
  if (opts.mode === 'stratum') {
    parseHost(opts.host ?? '127.0.0.1');
    parsePort(opts.port ?? STRATUM_PORT_DEFAULT);
    if (!(opts.worker ?? '').trim()) {
      throw new Error('worker is empty');
    }
    stratumSecret = opts.password ?? 'x';
  } else {
    payoutScript(opts.payout ?? '', activeChain);
    rpcHost = parseHost(opts.host ?? RPC_HOST);
    rpcPort = parsePort(opts.port ?? defaultRpcPort(activeChain));
    const datadir = (opts.datadir ?? '').trim() || defaultDatadir();
    activeCookieFile = cookiePathForDatadir(datadir, activeChain);
    cookieAuth = loadCookie(activeCookieFile);
    cookieSecret = cookieAuth.password;
  }
}

async function runMiner(opts: MinerStartOpts): Promise<void> {
  const chain = parseChain(opts.chain);
  if (opts.mode === 'stratum') {
    const host = parseHost(opts.host ?? '127.0.0.1');
    const port = parsePort(opts.port ?? STRATUM_PORT_DEFAULT);
    const worker = (opts.worker ?? '').trim();
    const password = opts.password ?? 'x';
    extraNonce1 = new Uint8Array(4);
    await mineStratumLoop({ host, port, worker, password, threads: opts.threads });
  } else {
    const payout = payoutScript(opts.payout ?? '', chain);
    extraNonce1 = new Uint8Array(4);
    await mineRpcLoop(payout, opts.threads);
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 760,
    height: 820,
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

ipcMain.handle('pool:start', async (_e, opts: PoolStartOpts) => {
  try {
    const chain = parseChain(opts.chain);
    if (chain === 'main' && !MAIN_IS_LIVE) {
      win?.webContents.send('miner:toast', 'MAIN is not live');
    }
    const args = poolArgv(opts);
    const cli = resolvePoolCli(process.env, here, process.resourcesPath);
    if (!cli) {
      throw new Error('federation-pool CLI not found (build ../federation-pool or set FEDERATION_POOL_CLI)');
    }
    stopPoolChild();
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    poolChild = child;
    poolStatsState = { ...IDLE_POOL_STATS, running: true, chain, status: 'starting' };
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
        emitLog('pool', msg, true);
        emitPoolStats();
      }
    });
    child.on('exit', (code) => {
      if (poolChild !== child) {
        return;
      }
      poolChild = null;
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
    emitLog('pool', error, true);
    return { ok: false as const, error };
  }
});

ipcMain.handle('pool:stop', async () => {
  emitLog('pool', 'stop');
  stopPoolChild();
});

ipcMain.handle(
  'miner:start',
  async (_e, opts: MinerStartOpts) => {
    try {
      const chain = parseChain(opts.chain);
      if (chain === 'main' && !MAIN_IS_LIVE) {
        win?.webContents.send('miner:toast', 'MAIN is not live');
      }
      if (running) {
        stopRequested = true;
        stratumClient?.close();
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
      lastRateAt = Date.now();
      lastError = '';
      emitStats();
      emitLog(activeMode, `start ${activeChain} ${activeMode}`);
      loopPromise = runMiner(opts)
        .catch((e) => {
          lastError = e instanceof Error ? e.message : String(e);
          emitLog(activeMode, lastError, true);
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
      emitLog(activeMode, lastError, true);
      emitStats();
      return { ok: false as const, error: lastError };
    }
  },
);

ipcMain.handle('miner:stop', async () => {
  stopRequested = true;
  running = false;
  cancelSleep();
  stratumClient?.close();
  killWorkers();
  status = 'stopped';
  emitLog(activeMode, 'stop');
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
  stratumClient?.close();
  killWorkers();
  stopPoolChild();
  app.quit();
});
