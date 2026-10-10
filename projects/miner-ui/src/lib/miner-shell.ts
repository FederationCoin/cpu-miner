import { InjectionToken } from '@angular/core';
import { APP_DEFAULTS, WEB_DEFAULTS, type AppDefaults, type HostedEndpoints, type WebDefaults } from './defaults/defaults';

export type { AppDefaults, HostedEndpoints, WebDefaults } from './defaults/defaults';
export { APP_DEFAULTS, WEB_DEFAULTS } from './defaults/defaults';

export type MinerShell =
  | { kind: 'desktop'; defaults: AppDefaults }
  | { kind: 'webDemo'; defaults: WebDefaults };

export const MINER_SHELL = new InjectionToken<MinerShell>('MINER_SHELL', {
  providedIn: 'root',
  factory: () => desktopShell(),
});

export const DEFAULT_HOSTED_TESTNET: HostedEndpoints = WEB_DEFAULTS.hosted;

export function desktopShell(): MinerShell {
  return { kind: 'desktop', defaults: APP_DEFAULTS };
}

export function webDemoShell(defaults: WebDefaults = WEB_DEFAULTS): MinerShell {
  return { kind: 'webDemo', defaults };
}

export type WorkspaceTab = 'node' | 'wallet' | 'mine' | 'gateway' | 'radar' | 'finder' | 'docs' | 'pool';
