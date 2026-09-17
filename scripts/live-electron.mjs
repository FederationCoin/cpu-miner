#!/usr/bin/env node
/**
 * Laptop-only. Drive the running Electron miner over Chrome DevTools Protocol.
 * Sequential app-pool Stratum (wallet A) then DATUM (wallet B), leave B
 * hashing, then wait on node RPC for a new block and check TIDES vouts.
 *
 * Not CI: no headless Electron runtime is wired in Actions. Angular `ng test`
 * (Karma) and miner vitest stay on `npm test`.
 *
 * Env: LIVE_BLOCK_GRIND_MS (default 2 hours), ELECTRON_CDP.
 * Exit: 0 on-chain match; 1 failure; 2 no node cookie; 4 template match,
 * block timed out (difficulty floor).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeAddress } from '../../federation-pool/dist/bech32.js';
import { cookiePathForDatadir, loadCookie, rpcCall } from '../../federation-pool/dist/rpc.js';

const CDP = process.env.ELECTRON_CDP ?? 'http://127.0.0.1:9222';
const BLOCK_MS = Number.parseInt(process.env.LIVE_BLOCK_GRIND_MS ?? '7200000', 10) || 7200000;

function addr(fill) {
  const a = encodeAddress('tgfcn', 1, new Uint8Array(32).fill(fill));
  if (!a) {
    throw new Error('encodeAddress failed');
  }
  return a;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapsEqual(a, b) {
  if (a.size !== b.size) {
    return false;
  }
  for (const [k, v] of a) {
    if (b.get(k) !== v) {
      return false;
    }
  }
  return true;
}

function payoutMap(payouts) {
  const m = new Map();
  for (const o of payouts ?? []) {
    if (!o?.miner) {
      continue;
    }
    const sats = BigInt(o.sats);
    if (sats === 0n) {
      continue;
    }
    m.set(o.miner, (m.get(o.miner) ?? 0n) + sats);
  }
  return m;
}

async function blockLanded(auth, rpcOpts, startCount, expected) {
  const count = await rpcCall(auth, 'getblockcount', [], rpcOpts);
  if (count <= startCount) {
    return false;
  }
  const hash = await rpcCall(auth, 'getblockhash', [count], rpcOpts);
  const block = await rpcCall(auth, 'getblock', [hash, 2], rpcOpts);
  const got = new Map();
  for (const o of block?.tx?.[0]?.vout ?? []) {
    const sats = BigInt(Math.round(Number(o.value) * 1e8));
    if (sats === 0n) {
      continue;
    }
    const a = o.scriptPubKey?.address;
    if (typeof a === 'string') {
      got.set(a, (got.get(a) ?? 0n) + sats);
    }
  }
  const expMap = payoutMap(expected);
  if (!mapsEqual(got, expMap)) {
    throw new Error('on-chain coinbase != TIDES split');
  }
  return true;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.text || 'evaluate failed';
      throw new Error(text);
    }
    return result.result?.value;
  }
}

async function connect() {
  const tabs = await fetch(`${CDP}/json/list`).then((r) => r.json());
  const page = tabs.find((t) => t.type === 'page' && /cpu-miner|index\.html|FederationCoin/i.test(`${t.title} ${t.url}`))
    ?? tabs.find((t) => t.type === 'page');
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`no Electron page at ${CDP}`);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('cdp websocket')), { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  return { cdp, ws };
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await cdp.eval(expression);
    if (last) {
      return last;
    }
    await sleep(400);
  }
  throw new Error(`${label}: timed out (${JSON.stringify(last)})`);
}

async function paste(cdp, id, text) {
  return cdp.eval(`(async () => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) throw new Error('missing ' + ${JSON.stringify(id)});
    el.focus();
    el.select?.();
    let via = 'input';
    try {
      await navigator.clipboard.writeText(${JSON.stringify(text)});
      if (document.execCommand('paste') && el.value === ${JSON.stringify(text)}) {
        via = 'execCommand';
      }
    } catch {
      via = 'input';
    }
    if (el.value !== ${JSON.stringify(text)}) {
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(text)});
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      if (el.value !== ${JSON.stringify(text)}) {
        el.value = ${JSON.stringify(text)};
      }
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { id: el.id, value: el.value, via };
  })()`);
}

function gpuDomId(id) {
  return String(id).replace(/[^a-zA-Z0-9]+/g, '-');
}

async function selectFirstGpu(cdp) {
  const hasBtn = await cdp.eval(`!!document.getElementById('testnet-detectGpus')`);
  if (!hasBtn) {
    return { selected: null, checked: false, reason: 'missing detect button' };
  }
  await cdp.eval(`document.getElementById('testnet-detectGpus').click()`);
  await waitFor(
    cdp,
    `(() => {
      const b = document.getElementById('testnet-detectGpus');
      if (!b || b.disabled) return null;
      if (/Detecting/i.test(b.textContent || '')) return null;
      return true;
    })()`,
    30000,
    'gpu scan',
  );
  const scan = await cdp.eval(`window.miner.gpus()`);
  const devices = Array.isArray(scan?.devices) ? scan.devices : Array.isArray(scan) ? scan : [];
  const firstDev = devices.find((d) => d && typeof d.id === 'string' && d.id.length > 0) ?? null;
  if (!firstDev) {
    const hint = await cdp.eval(`document.querySelector('#testnet-gpus .hint')?.textContent ?? ''`);
    return { selected: null, checked: false, hint, scan };
  }
  const checkbox = `testnet-gpu-${gpuDomId(firstDev.id)}`;
  await waitFor(cdp, `document.getElementById(${JSON.stringify(checkbox)})`, 10000, 'gpu checkbox');
  await cdp.eval(`(() => {
    const el = document.getElementById(${JSON.stringify(checkbox)});
    if (!el) throw new Error('missing gpu checkbox');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const checked = await cdp.eval(`document.getElementById(${JSON.stringify(checkbox)})?.checked === true`);
  return { selected: firstDev.id, checkbox, checked, scan };
}

function snapshot(cdp) {
  return cdp.eval(`(() => {
    const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? '';
    const val = (id) => document.getElementById(id)?.value ?? null;
    const checked = (id) => !!document.getElementById(id)?.checked;
    const exists = (id) => !!document.getElementById(id);
    const rec = (root) => {
      const dl = document.querySelector(root + ' dl');
      if (!dl) return {};
      return Object.fromEntries(
        [...dl.querySelectorAll('dt')].map((dt, i) => [dt.textContent.trim(), dl.querySelectorAll('dd')[i]?.textContent.trim() ?? '']),
      );
    };
    let tides = [];
    try {
      tides = JSON.parse(document.querySelector('#testnet-pool [data-tides]')?.getAttribute('data-tides') || '[]');
    } catch {
      tides = [];
    }
    return {
      network: val('network-toggle'),
      operator: val('testnet-pool-operator'),
      poolStatus: rec('#testnet-pool').Status ?? '',
      poolHeight: rec('#testnet-pool').Height ?? '',
      poolWorkers: rec('#testnet-pool').Workers ?? '',
      poolAccepted: rec('#testnet-pool').Accepted ?? '',
      mineStatus: rec('#testnet-mining').Status ?? '',
      kind: {
        node: checked('testnet-mineToNode'),
        stratum: checked('testnet-mineToStratum'),
        datum: checked('testnet-mineToDatum'),
        appS: exists('testnet-mineToAppPoolStratum') && checked('testnet-mineToAppPoolStratum'),
        appD: exists('testnet-mineToAppPoolDatum') && checked('testnet-mineToAppPoolDatum'),
      },
      appPoolRadios: exists('testnet-mineToAppPoolStratum'),
      frozen: txt('.frozen'),
      toast: txt('[role="status"]'),
      err: txt('[data-chain="testnet"] .err'),
      startDisabled: !!document.getElementById('testnet-start')?.disabled,
      stopDisabled: !!document.getElementById('testnet-stop')?.disabled,
      poolStartDisabled: !!document.getElementById('testnet-pool-start')?.disabled,
      poolStopDisabled: !!document.getElementById('testnet-pool-stop')?.disabled,
      mining: rec('#testnet-mining'),
      pool: rec('#testnet-pool'),
      tides,
    };
  })()`);
}

async function readRpcForm(cdp) {
  return cdp.eval(`(() => {
    const cookie = !!document.getElementById('testnet-pool-authCookie')?.checked;
    return {
      host: document.getElementById('testnet-pool-rpcHost')?.value ?? '127.0.0.1',
      port: Number(document.getElementById('testnet-pool-rpcPort')?.value || 35332),
      cookie,
      datadir: document.getElementById('testnet-pool-datadir')?.value ?? '',
      user: cookie ? '' : (document.getElementById('testnet-pool-rpcUser')?.value ?? ''),
      password: cookie ? '' : (document.getElementById('testnet-pool-rpcPassword')?.value ?? ''),
    };
  })()`);
}

function nodeAuth(form) {
  if (form.cookie) {
    const datadir = (form.datadir || '').trim() || join(homedir(), '.federationcoin');
    const path = cookiePathForDatadir(datadir, 'testnet');
    if (!existsSync(path)) {
      process.stderr.write('live-electron: testnet cookie missing; start federationcoind -testnet\n');
      process.exit(2);
    }
    return { auth: loadCookie(path), rpcOpts: { host: form.host, port: form.port } };
  }
  if (!(form.user || '').trim()) {
    throw new Error('RPC username/password is empty');
  }
  return {
    auth: { user: form.user, password: form.password },
    rpcOpts: { host: form.host, port: form.port },
  };
}

const operator = addr(1);
const walletA = addr(10);
const walletB = addr(11);

async function main() {
  const out = { operatorLen: operator.length, walletALen: walletA.length };
  const { cdp, ws } = await connect();
  try {
  const net = await cdp.eval(`document.getElementById('network-toggle')?.value`);
  if (net !== 'testnet') {
    throw new Error(`network is ${net}, expected testnet`);
  }
  const rpcForm = await readRpcForm(cdp);
  const { auth, rpcOpts } = nodeAuth(rpcForm);
  const startCount = await rpcCall(auth, 'getblockcount', [], rpcOpts);
  out.startCount = startCount;

  out.pasteOperator = await paste(cdp, 'testnet-pool-operator', operator);
  if (out.pasteOperator.value !== operator) {
    throw new Error('operator paste failed');
  }
  await cdp.eval(`document.getElementById('testnet-pool-start').click()`);
  out.poolAfterStart = await waitFor(
    cdp,
    `(() => {
      const dl = document.querySelector('#testnet-pool dl');
      const dts = [...(dl?.querySelectorAll('dt') ?? [])].map((n) => n.textContent.trim());
      const dds = [...(dl?.querySelectorAll('dd') ?? [])].map((n) => n.textContent.trim());
      const rec = Object.fromEntries(dts.map((k, i) => [k, dds[i] ?? '']));
      const radios = !!document.getElementById('testnet-mineToAppPoolStratum');
      const status = rec.Status || '';
      return (radios && /height/i.test(status)) ? { status, height: Number(rec.Height || 0), radios } : null;
    })()`,
    25000,
    'pool start',
  );

  await cdp.eval(`document.getElementById('testnet-mineToAppPoolStratum').click()`);
  out.gpu = await selectFirstGpu(cdp);
  if (!out.gpu.selected || out.gpu.checked !== true) {
    throw new Error(`GPU not selected (${out.gpu.hint ?? out.gpu.reason ?? 'no card'})`);
  }
  out.pasteAppStratum = await paste(cdp, 'testnet-appPoolStratumWorker', `${walletA}.cpu`);
  await cdp.eval(`document.getElementById('testnet-start').click()`);
  out.appStratum = await waitFor(
    cdp,
    `(() => {
      const dl = document.querySelector('#testnet-mining dl');
      const rec = Object.fromEntries([...dl.querySelectorAll('dt')].map((dt, i) => [dt.textContent.trim(), dl.querySelectorAll('dd')[i]?.textContent.trim() ?? '']));
      const accepted = Number(rec.Accepted || 0);
      const err = document.querySelector('#testnet-mining .err')?.textContent ?? '';
      if (accepted > 0 && /stratum/i.test(rec.Endpoint || '')) return { rec, err };
      return null;
    })()`,
    90000,
    'app-pool stratum hasher',
  );
  await cdp.eval(`document.getElementById('testnet-stop').click()`);
  await waitFor(
    cdp,
    `document.getElementById('testnet-start') && !document.getElementById('testnet-start').disabled`,
    10000,
    'hasher stop',
  );

  await cdp.eval(`document.getElementById('testnet-mineToAppPoolDatum').click()`);
  out.pasteAppDatumRpc = await paste(cdp, 'testnet-appPoolDatum-rpcHost', '127.0.0.1');
  out.pasteAppDatum = await paste(cdp, 'testnet-appPoolDatumWorker', `${walletB}.datum`);
  await cdp.eval(`document.getElementById('testnet-start').click()`);
  await waitFor(
    cdp,
    `(() => {
      const dl = document.querySelector('#testnet-mining dl');
      const rec = Object.fromEntries([...dl.querySelectorAll('dt')].map((dt, i) => [dt.textContent.trim(), dl.querySelectorAll('dd')[i]?.textContent.trim() ?? '']));
      return Number(rec.Accepted || 0) === 0 && /datum/i.test(rec.Endpoint || '') ? rec : null;
    })()`,
    10000,
    'datum hasher reset',
  );
  out.appDatum = await waitFor(
    cdp,
    `(() => {
      const dl = document.querySelector('#testnet-mining dl');
      const rec = Object.fromEntries([...dl.querySelectorAll('dt')].map((dt, i) => [dt.textContent.trim(), dl.querySelectorAll('dd')[i]?.textContent.trim() ?? '']));
      const accepted = Number(rec.Accepted || 0);
      if (accepted > 0 && /datum/i.test(rec.Endpoint || '')) {
        return { rec };
      }
      return null;
    })()`,
    90000,
    'app-pool datum hasher',
  );
  await waitFor(
    cdp,
    `(() => {
      const dl = document.querySelector('#testnet-pool dl');
      const rec = Object.fromEntries([...dl.querySelectorAll('dt')].map((dt, i) => [dt.textContent.trim(), dl.querySelectorAll('dd')[i]?.textContent.trim() ?? '']));
      return Number(rec.Accepted || 0) >= 2 ? rec : null;
    })()`,
    15000,
    'pool accepted A and B',
  );

  out.refresh = await cdp.eval(`window.miner.poolRefresh()`);
  if (!out.refresh?.ok) {
    throw new Error(`pool refresh failed: ${out.refresh?.error ?? 'unknown'}`);
  }
  out.tides = await waitFor(
    cdp,
    `(() => {
      const raw = document.querySelector('#testnet-pool [data-tides]')?.getAttribute('data-tides');
      if (!raw) return null;
      let payouts;
      try { payouts = JSON.parse(raw); } catch { return null; }
      if (!Array.isArray(payouts) || payouts.length === 0) return null;
      const miners = new Set(payouts.map((p) => p.miner));
      if (miners.has(${JSON.stringify(walletA)}) && miners.has(${JSON.stringify(walletB)})) return payouts;
      return null;
    })()`,
    25000,
    'TIDES payouts',
  );
  const expMap = payoutMap(out.tides);
  if ((expMap.get(walletA) ?? 0n) <= 0n || (expMap.get(walletB) ?? 0n) <= 0n) {
    throw new Error('TIDES template missing contributor');
  }
  process.stdout.write(
    `live-electron: template ok miners=${out.tides.filter((p) => p.miner !== operator).length} outs=${out.tides.length} startHeight=${startCount}\n`,
  );

  const deadline = Date.now() + BLOCK_MS;
  let lastBeat = 0;
  while (Date.now() < deadline) {
    if (await blockLanded(auth, rpcOpts, startCount, out.tides)) {
      const height = await rpcCall(auth, 'getblockcount', [], rpcOpts);
      process.stdout.write(`live-electron: ok on-chain TIDES height=${height} gpu=${out.gpu.selected ?? 'none'}\n`);
      process.exitCode = 0;
      return;
    }
    const now = Date.now();
    if (now - lastBeat >= 30000) {
      lastBeat = now;
      let hashes = '';
      let status = '';
      try {
        const snap = await snapshot(cdp);
        hashes = snap.mining?.Hashes ?? '';
        status = snap.mining?.Status ?? '';
      } catch {
        hashes = 'cdp-lost';
        status = 'cdp-lost';
      }
      const height = await rpcCall(auth, 'getblockcount', [], rpcOpts);
      process.stderr.write(
        `live-electron: waiting height start=${startCount} now=${height} hashes=${hashes} status=${status} elapsed=${Math.round((now - (deadline - BLOCK_MS)) / 1000)}s\n`,
      );
    }
    await sleep(1000);
  }
  process.stdout.write(
    `live-electron: TIDES template verified; block grind timed out (${BLOCK_MS}ms). CPU cannot regularly hit the Blake2b floor; re-run with GPU hashrate.\n`,
  );
  process.exitCode = 4;
} catch (e) {
  try {
    out.failSnap = await snapshot(cdp);
  } catch {
    /* ignore */
  }
  process.stderr.write(`live-electron: fail ${e instanceof Error ? e.message : String(e)}\n`);
  process.stderr.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  ws.close();
  process.exit(process.exitCode ?? 0);
}
}

await main();
