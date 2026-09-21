import { spawn, type ChildProcess } from 'node:child_process';
import { MAIN_IS_LIVE, RPC_PORT_TESTNET, type MinerChain } from './chain.js';
import { defaultDatadir } from './rpc.js';
import type { AddonPresence } from './extras.js';

export type NodeSession =
  | { kind: 'idle' }
  | { kind: 'spawned'; child: ChildProcess; chain: MinerChain }
  | { kind: 'attached'; chain: MinerChain };

export type NodeStatus = {
  session: 'idle' | 'spawned' | 'attached';
  chain: MinerChain | null;
  height: number;
  running: boolean;
  lastError: string;
};

export const IDLE_NODE_STATUS: NodeStatus = {
  session: 'idle',
  chain: null,
  height: 0,
  running: false,
  lastError: '',
};

export function nodeArgv(
  chain: MinerChain,
  datadir: string,
  rpcPort: number,
  mainLive: boolean = MAIN_IS_LIVE,
): string[] {
  if (chain === 'main' && !mainLive) {
    throw new Error('MAIN is not live');
  }
  const args: string[] = [];
  if (chain === 'testnet') {
    args.push('-testnet');
  }
  args.push(
    `-datadir=${datadir}`,
    '-server=1',
    '-bind=127.0.0.1',
    '-rpcbind=127.0.0.1',
    '-rpcallowip=127.0.0.1',
    `-rpcport=${rpcPort}`,
  );
  return args;
}

export function spawnNode(bin: AddonPresence, chain: MinerChain, datadir = defaultDatadir()): ChildProcess {
  if (bin.kind !== 'present') {
    throw new Error('federationcoind addon was not included in this build');
  }
  const args = nodeArgv(chain, datadir, RPC_PORT_TESTNET);
  return spawn(bin.path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

export function canStopNode(session: NodeSession): boolean {
  return session.kind === 'spawned';
}
