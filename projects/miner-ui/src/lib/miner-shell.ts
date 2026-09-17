import { InjectionToken } from '@angular/core';

export type HostedEndpoints = {
  label: string;
  stratumTcp: { host: string; port: number };
  datumTcp: { host: string; port: number };
  stratumWss: string;
  datumWss: string;
  statsUrl: string;
};

export type MinerShell =
  | { kind: 'desktop' }
  | { kind: 'webDemo'; hosted: HostedEndpoints };

export const MINER_SHELL = new InjectionToken<MinerShell>('MINER_SHELL', {
  providedIn: 'root',
  factory: () => ({ kind: 'desktop' }),
});

export const DEFAULT_HOSTED_TESTNET: HostedEndpoints = {
  label: 'FederationCoin testnet pool',
  stratumTcp: { host: 'stratum.testnet.federationcoin.org', port: 23334 },
  datumTcp: { host: 'datum.testnet.federationcoin.org', port: 28916 },
  stratumWss: 'wss://pool.testnet.federationcoin.org/stratum',
  datumWss: 'wss://pool.testnet.federationcoin.org/datum',
  statsUrl: 'https://pool.testnet.federationcoin.org/api/stats',
};

export function desktopShell(): MinerShell {
  return { kind: 'desktop' };
}

export function webDemoShell(hosted: HostedEndpoints = DEFAULT_HOSTED_TESTNET): MinerShell {
  return { kind: 'webDemo', hosted };
}

export type WorkspaceTab = 'mine' | 'pool' | 'docs' | 'finder';
