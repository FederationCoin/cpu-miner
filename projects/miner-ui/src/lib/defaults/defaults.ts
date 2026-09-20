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

export type WebChainDefaults = {
  mineToKind: MineToKind;
  stratumPoolWebsocket: { url: string };
  datumGatewayWebsocket: { url: string };
};

export type WebDefaults = {
  hosted: HostedEndpoints;
  registryBaseUrl: string;
  chains: {
    main: WebChainDefaults;
    testnet: WebChainDefaults;
  };
};

export type AppChainDefaults = {
  mineToKind: MineToKind;
  rpc: { host: string; port: number };
  stratum: StratumFormDefaults;
  pool: {
    stratumHost: string;
    stratumPort: number;
    datumHost: string;
    datumPort: number;
    feePercent: string;
  };
};

export type AppDefaults = {
  registryBaseUrl: string;
  chains: {
    main: AppChainDefaults;
    testnet: AppChainDefaults;
  };
};

export const WEB_DEFAULTS: WebDefaults = webJson as WebDefaults;
export const APP_DEFAULTS: AppDefaults = appJson as AppDefaults;
