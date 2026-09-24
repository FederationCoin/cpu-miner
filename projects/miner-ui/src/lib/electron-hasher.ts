import {
  EMPTY_GATEWAY_STATUS,
  EMPTY_NODE_STATUS,
  type GpuScan,
  type MinerInfo,
  type MinerStartOpts,
  type MinerStats,
  type MinerToast,
  type PoolStartOpts,
  type PoolStats,
} from './miner-api';
import type { HasherHost } from './hasher-host';
import type { RegistryRequest } from './registry';
import { bindDesktopWebGpu } from './webgpu-desktop';

export class ElectronHasherHost implements HasherHost {
  constructor() {
    if (window.miner) {
      bindDesktopWebGpu(window.miner);
    }
  }

  get canMine(): boolean {
    return !!window.miner;
  }

  get inElectron(): boolean {
    return !!window.miner;
  }

  async start(opts: MinerStartOpts): Promise<{ ok: boolean; error?: string }> {
    const api = window.miner;
    if (!api) {
      return { ok: false, error: 'Open this app with npm start (Electron), not ng serve.' };
    }
    return api.start(opts);
  }

  async stop(): Promise<void> {
    await window.miner?.stop();
  }

  info(): Promise<MinerInfo | null> {
    return window.miner?.info() ?? Promise.resolve(null);
  }

  async gpus(): Promise<GpuScan> {
    const empty: GpuScan = { devices: [], addon: false };
    try {
      return (await window.miner?.gpus()) ?? empty;
    } catch {
      return empty;
    }
  }

  pickDatadir(): Promise<string | null> {
    return window.miner?.pickDatadir() ?? Promise.resolve(null);
  }

  onStats(cb: (s: MinerStats) => void): () => void {
    return window.miner?.onStats(cb) ?? (() => undefined);
  }

  onToast(cb: (toast: MinerToast) => void): () => void {
    return window.miner?.onToast(cb) ?? (() => undefined);
  }

  async poolStart(opts: PoolStartOpts): Promise<{ ok: boolean; error?: string }> {
    const api = window.miner;
    if (!api?.poolStart) {
      return { ok: false, error: 'Open this app with npm start (Electron), not ng serve.' };
    }
    return api.poolStart(opts);
  }

  async poolStop(): Promise<void> {
    await window.miner?.poolStop();
  }

  onPoolStats(cb: (s: PoolStats) => void): () => void {
    return window.miner?.onPoolStats(cb) ?? (() => undefined);
  }

  registryRequest(req: RegistryRequest) {
    const api = window.miner;
    if (!api?.registryRequest) {
      return Promise.reject(new Error('Open this app with npm start (Electron), not ng serve.'));
    }
    return api.registryRequest(req);
  }

  extrasProbe() {
    return window.miner?.extrasProbe?.() ?? Promise.resolve({ node: false, gateway: false, pool: false });
  }

  nodeStart(opts: { chain: import('./miner-api').MinerChain; datadir: string }) {
    return window.miner?.nodeStart?.(opts) ?? Promise.resolve({ ok: false, error: 'no node module' });
  }

  nodeStop() {
    return window.miner?.nodeStop?.() ?? Promise.resolve({ ok: false, error: 'no node module' });
  }

  nodeStatus(opts: { chain: import('./miner-api').MinerChain; datadir: string }) {
    return window.miner?.nodeStatus?.(opts) ?? Promise.resolve(EMPTY_NODE_STATUS);
  }

  gatewayStart(opts: {
    chain: import('./miner-api').MinerChain;
    poolAddress: string;
    poolHost?: string;
    poolPubkey?: string;
    configPath?: string;
  }) {
    return window.miner?.gatewayStart?.(opts) ?? Promise.resolve({ ok: false, error: 'no gateway module' });
  }

  gatewayStop() {
    return window.miner?.gatewayStop?.() ?? Promise.resolve({ ok: false, error: 'no gateway module' });
  }

  gatewayStatus(opts: { chain: import('./miner-api').MinerChain; configPath: string }) {
    return window.miner?.gatewayStatus?.(opts) ?? Promise.resolve(EMPTY_GATEWAY_STATUS);
  }

  fetchPrimeKeys(url: string) {
    return window.miner?.fetchPrimeKeys?.(url) ?? Promise.resolve({ ok: false, error: 'no gateway module' });
  }

  walletLoad(chain: import('./miner-api').MinerChain) {
    return window.miner?.walletLoad?.(chain) ?? Promise.resolve(null);
  }

  walletSave(chain: import('./miner-api').MinerChain, blob: string) {
    return window.miner?.walletSave?.(chain, blob) ?? Promise.resolve({ ok: false, error: 'no wallet store' });
  }
}
