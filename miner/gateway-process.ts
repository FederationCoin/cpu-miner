import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MAIN_IS_LIVE, type MinerChain } from './chain.js';
import type { AddonPresence } from './extras.js';
import { formatCommand } from './process-usage.js';

export type GatewaySession =
  | { kind: 'idle' }
  | { kind: 'spawned'; child: ChildProcess; chain: MinerChain; command: string; configPath: string };

export function gatewayCommand(binPath: string, configPath: string): string {
  return formatCommand(binPath, ['-c', configPath]);
}

export type GatewayStartOpts = {
  chain: MinerChain;
  rpcUrl: string;
  rpcUser: string;
  rpcPassword: string;
  poolAddress: string;
  poolHost: string;
  poolPubkey: string;
  configPath: string;
};

export function gatewayConfig(opts: GatewayStartOpts): Record<string, unknown> {
  if (opts.chain === 'main' && !MAIN_IS_LIVE) {
    throw new Error('MAIN is not live');
  }
  return {
    bitcoind: {
      rpcuser: opts.rpcUser,
      rpcpassword: opts.rpcPassword,
      rpcurl: opts.rpcUrl,
      notify_fallback: true,
    },
    stratum: {
      listen_addr: '127.0.0.1',
      listen_port: 23334,
      ws_listen_addr: '127.0.0.1',
      ws_listen_port: 23335,
      ws_gateway_info: true,
    },
    mining: {
      pool_address: opts.poolAddress,
      coinbase_tag_primary: 'DATUM Gateway',
      pool_name: '',
      pool_website: '',
      coinbase_tag_secondary: 'DATUM User',
    },
    api: {
      admin_password: '',
      listen_port: 0,
      modify_conf: false,
    },
    logger: {
      log_to_console: true,
      log_to_file: false,
      log_level_console: 2,
    },
    datum: {
      pool_host: opts.poolHost.trim(),
      pool_pubkey: opts.poolPubkey.trim(),
      pool_pass_workers: true,
      pool_pass_full_users: true,
      pooled_mining_only: false,
    },
  };
}

export function writeGatewayConfig(opts: GatewayStartOpts): void {
  const body = JSON.stringify(gatewayConfig(opts), null, 2);
  mkdirSync(dirname(opts.configPath), { recursive: true });
  writeFileSync(opts.configPath, body);
}

export function spawnGateway(bin: AddonPresence, opts: GatewayStartOpts): ChildProcess {
  if (bin.kind !== 'present') {
    throw new Error('datum_gateway addon was not included in this build');
  }
  writeGatewayConfig(opts);
  return spawn(bin.path, ['-c', opts.configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
}

export function canStopGateway(session: GatewaySession): boolean {
  return session.kind === 'spawned';
}
