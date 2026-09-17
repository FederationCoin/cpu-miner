import type { MineToKind } from '../miner-api';
import appJson from './app.json';
import webJson from './web.json';

export type HostedEndpoints = {
  label: string;
  stratumTcp: { host: string; port: number };
  datumTcp: { host: string; port: number };
  stratumWss: string;
  datumWss: string;
  statsUrl: string;
};

export type StratumFormDefaults = {
  host: string;
  port: number;
  password: string;
};

export type DatumWebsocketFormDefaults = {
  url: string;
};

export type WebChainDefaults = {
  mineToKind: MineToKind;
  stratumWebsocket: StratumFormDefaults;
  datumWebsocket: DatumWebsocketFormDefaults;
};

export type WebDefaults = {
  hosted: HostedEndpoints;
  chains: {
    main: WebChainDefaults;
    testnet: WebChainDefaults;
  };
};

export type AppChainDefaults = {
  mineToKind: MineToKind;
  rpc: { host: string; port: number };
  stratum: StratumFormDefaults;
  datum: { host: string; port: number };
  datumWebsocket: DatumWebsocketFormDefaults;
  pool: {
    stratumHost: string;
    stratumPort: number;
    datumHost: string;
    datumPort: number;
    feePercent: string;
  };
};

export type AppDefaults = {
  chains: {
    main: AppChainDefaults;
    testnet: AppChainDefaults;
  };
};

export const WEB_DEFAULTS: WebDefaults = webJson as WebDefaults;
export const APP_DEFAULTS: AppDefaults = appJson as AppDefaults;
