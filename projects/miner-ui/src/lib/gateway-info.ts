import type { PeerStatus } from './stratum-ws';

export type GatewayInfoView =
  | { kind: 'notRequested' }
  | { kind: 'notProvided'; asOf: number }
  | {
      kind: 'provided';
      asOf: number;
      nodeStatus: PeerStatus;
      name: string;
      coinbaseTag: string;
      websiteUrl: string;
      prime?: string;
      poolStatus?: PeerStatus;
    };
