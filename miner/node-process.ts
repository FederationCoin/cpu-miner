import { spawn, type ChildProcess } from 'node:child_process';
import { MAIN_IS_LIVE, defaultRpcPort, type MinerChain } from './chain.js';
import { defaultDatadir } from './rpc.js';
import type { AddonPresence } from './extras.js';
import { listenBindAddr, type ListenReach } from './listen-reach.js';
import { formatCommand, nodePorts, type PeerLine, type PortLine, type TxLine } from './process-usage.js';

export type NodeSession =
  | { kind: 'idle' }
  | {
      kind: 'spawned';
      child: ChildProcess;
      chain: MinerChain;
      command: string;
      datadir: string;
      listenReach: ListenReach;
      rpc: boolean;
    }
  | { kind: 'attached'; chain: MinerChain; datadir: string };

export type NodeStatus = {
  session: 'idle' | 'spawned' | 'attached';
  chain: MinerChain | null;
  height: number;
  running: boolean;
  lastError: string;
  pid: number | null;
  command: string;
  datadir: string;
  cpu: string;
  rss: string;
  otherCount: number;
  ports: PortLine[];
  logTail: string;
  peers: PeerLine[];
  trafficIn: string;
  trafficOut: string;
  transactions: TxLine[];
  transactionsNote: string;
  connectHost: string;
  connectPort: number;
};

export const IDLE_NODE_STATUS: NodeStatus = {
  session: 'idle',
  chain: null,
  height: 0,
  running: false,
  lastError: '',
  pid: null,
  command: '',
  datadir: '',
  cpu: '',
  rss: '',
  otherCount: 0,
  ports: [],
  logTail: '',
  peers: [],
  trafficIn: '',
  trafficOut: '',
  transactions: [],
  transactionsNote: '',
  connectHost: '',
  connectPort: 0,
};

export function nodeCommand(
  binPath: string,
  chain: MinerChain,
  datadir: string,
  reach: ListenReach = 'computer',
  rpc = true,
): string {
  return formatCommand(binPath, nodeArgv(chain, datadir, defaultRpcPort(chain), MAIN_IS_LIVE, reach, rpc));
}

export function nodeArgv(
  chain: MinerChain,
  datadir: string,
  rpcPort: number,
  mainLive: boolean = MAIN_IS_LIVE,
  reach: ListenReach = 'computer',
  rpc = true,
): string[] {
  if (chain === 'main' && !mainLive) {
    throw new Error('MAIN is not live');
  }
  const bind = listenBindAddr(reach);
  const args: string[] = [];
  if (chain === 'testnet') {
    args.push('-testnet');
  }
  args.push(`-datadir=${datadir}`, `-bind=${bind}`);
  if (rpc) {
    args.push('-server=1', `-rpcbind=${bind}`, '-rpcallowip=127.0.0.1');
    if (reach === 'network') {
      args.push('-rpcallowip=10.0.0.0/8', '-rpcallowip=172.16.0.0/12', '-rpcallowip=192.168.0.0/16');
    }
    args.push(`-rpcport=${rpcPort}`);
  }
  args.push('-natpmp=0', '-upnp=0');
  return args;
}

export function spawnNode(
  bin: AddonPresence,
  chain: MinerChain,
  datadir = defaultDatadir(),
  reach: ListenReach = 'computer',
  rpc = true,
): ChildProcess {
  if (bin.kind !== 'present') {
    throw new Error('federationcoind addon was not included in this build');
  }
  const args = nodeArgv(chain, datadir, defaultRpcPort(chain), MAIN_IS_LIVE, reach, rpc);
  return spawn(bin.path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

export function nodePortLines(chain: MinerChain): PortLine[] {
  return nodePorts(chain);
}

export function canStopNode(session: NodeSession): boolean {
  return session.kind === 'spawned';
}
