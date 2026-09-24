import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { MinerChain } from './chain.js';
import { redactSecret } from './log.js';

export type PortLine = { label: string; port: number };
export type PeerLine = { addr: string; bytesSent: number; bytesRecv: number };
export type TxLine = { txid: string; amount: string; category: string };
export type TickSample = { ticks: number; at: number };

export function formatCommand(bin: string, args: string[]): string {
  const path = bin.trim();
  if (!path) {
    return '';
  }
  return [path, ...args].join(' ');
}

export function nodePorts(chain: MinerChain): PortLine[] {
  if (chain === 'testnet') {
    return [
      { label: 'RPC', port: 35332 },
      { label: 'P2P', port: 35333 },
    ];
  }
  return [{ label: 'RPC', port: 4094 }];
}

export function gatewayPorts(): PortLine[] {
  return [
    { label: 'Stratum', port: 23334 },
    { label: 'WebSocket', port: 23335 },
  ];
}

export function nodeDebugLogPath(datadir: string, chain: MinerChain): string {
  const d = datadir.trim().replace(/[/\\]+$/, '');
  if (chain === 'main' || basename(d) === 'testnet3') {
    return join(d, 'debug.log');
  }
  return join(d, 'testnet3', 'debug.log');
}

export function tailLines(text: string, max = 80): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - max)).join('\n').trim();
}

export function readLogTail(path: string, secret: string): string {
  try {
    return redactSecret(tailLines(readFileSync(path, 'utf8')), secret);
  } catch {
    return '';
  }
}

export function pushRing(lines: string[], chunk: string, max = 80): string[] {
  const next = chunk
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...lines, ...next].slice(-max);
}

export function ticksFromStat(stat: string): number | null {
  const end = stat.lastIndexOf(')');
  if (end < 0) {
    return null;
  }
  const rest = stat.slice(end + 2).trim().split(/\s+/);
  if (rest.length < 13) {
    return null;
  }
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) {
    return null;
  }
  return utime + stime;
}

export function formatRss(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function rssFromStatm(statm: string, page = 4096): string {
  const pages = Number(statm.trim().split(/\s+/)[1]);
  if (!Number.isFinite(pages) || pages < 0) {
    return '';
  }
  return formatRss(pages * page);
}

export function cpuPercent(deltaTicks: number, elapsedMs: number, clk = 100): string {
  if (!(elapsedMs >= 200) || !Number.isFinite(deltaTicks) || deltaTicks < 0) {
    return '';
  }
  const pct = (deltaTicks / clk / (elapsedMs / 1000)) * 100;
  if (pct > 10000) {
    return '';
  }
  return `${pct.toFixed(1)}%`;
}

export function usageFromSamples(
  stat: string,
  statm: string,
  prev: TickSample | undefined,
  now: number,
  clk = 100,
): { cpu: string; rss: string; sample: TickSample } | null {
  const ticks = ticksFromStat(stat);
  if (ticks == null) {
    return null;
  }
  let cpu = '';
  if (prev && now > prev.at) {
    cpu = cpuPercent(ticks - prev.ticks, now - prev.at, clk);
  }
  return { cpu, rss: rssFromStatm(statm), sample: { ticks, at: now } };
}

export function usageFromWindowsLine(
  cpuSeconds: number,
  workingSet: number,
  prev: { cpu: number; at: number } | undefined,
  now: number,
): { cpu: string; rss: string; sample: { cpu: number; at: number } } {
  let cpu = '';
  if (prev && now - prev.at >= 200 && Number.isFinite(cpuSeconds)) {
    const delta = cpuSeconds - prev.cpu;
    const pct = (delta / ((now - prev.at) / 1000)) * 100;
    if (delta >= 0 && pct <= 10000) {
      cpu = `${pct.toFixed(1)}%`;
    }
  }
  return {
    cpu,
    rss: formatRss(workingSet),
    sample: { cpu: Number.isFinite(cpuSeconds) ? cpuSeconds : 0, at: now },
  };
}

export function readUsage(
  pid: number,
  prev: TickSample | undefined,
  now: number,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): { cpu: string; rss: string; sample?: TickSample } {
  try {
    const parsed = usageFromSamples(read(`/proc/${pid}/stat`), read(`/proc/${pid}/statm`), prev, now);
    if (!parsed) {
      return { cpu: '', rss: '' };
    }
    return parsed;
  } catch {
    return { cpu: '', rss: '' };
  }
}

export function pidsWithCommIn(root: string, comm: string): number[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const out: number[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) {
      continue;
    }
    try {
      const text = readFileSync(join(root, name, 'comm'), 'utf8').trim();
      if (text === comm) {
        out.push(Number(name));
      }
    } catch {
      /* not a process dir */
    }
  }
  return out;
}

export function pidsFromLines(text: string): number[] {
  return text
    .split(/\r?\n/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function otherProcessCount(pids: number[], ownPid: number | null): number {
  return pids.filter((p) => p !== ownPid).length;
}

export function peersFromRpc(raw: unknown): PeerLine[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: PeerLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const rec = row as { addr?: unknown; bytessent?: unknown; bytesrecv?: unknown };
    const addr = String(rec.addr ?? '').trim();
    if (!addr) {
      continue;
    }
    out.push({
      addr,
      bytesSent: Number(rec.bytessent ?? 0) || 0,
      bytesRecv: Number(rec.bytesrecv ?? 0) || 0,
    });
    if (out.length >= 12) {
      break;
    }
  }
  return out;
}

export function trafficFromRpc(raw: unknown): { inn: string; out: string } {
  if (!raw || typeof raw !== 'object') {
    return { inn: '', out: '' };
  }
  const rec = raw as { totalbytesrecv?: unknown; totalbytessent?: unknown };
  return {
    inn: rec.totalbytesrecv == null ? '' : String(rec.totalbytesrecv),
    out: rec.totalbytessent == null ? '' : String(rec.totalbytessent),
  };
}

export function txsFromRpc(raw: unknown): TxLine[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: TxLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const rec = row as { txid?: unknown; amount?: unknown; category?: unknown };
    const txid = String(rec.txid ?? '').trim();
    const category = String(rec.category ?? '').trim();
    if (!txid && !category) {
      continue;
    }
    out.push({
      txid: txid.slice(0, 16),
      amount: rec.amount == null ? '' : String(rec.amount),
      category,
    });
    if (out.length >= 8) {
      break;
    }
  }
  return out;
}

export function txNote(ok: boolean): string {
  return ok ? 'Broadcasts the node wallet knows about.' : 'Node wallet RPC is off.';
}
