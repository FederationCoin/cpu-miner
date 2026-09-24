import type { MinerChain } from './chain';
import { STRATUM_PASSWORD } from './miner-api';

export function storageKey(chain: MinerChain, suffix: string): string {
  return `fc.${chain}.${suffix}`;
}

export function loopbackBind(host: string): string {
  const h = host.trim();
  if (!h || h === '0.0.0.0' || h === '::' || h === '[::]') {
    return '127.0.0.1';
  }
  return h;
}

export function applyDesktopStratumTarget(chain: MinerChain, host: string, port: number): void {
  localStorage.setItem(storageKey(chain, 'kind'), 'stratum');
  localStorage.setItem(storageKey(chain, 'stratum.host'), loopbackBind(host));
  localStorage.setItem(storageKey(chain, 'stratum.port'), String(port));
  localStorage.setItem(storageKey(chain, 'stratum.password'), STRATUM_PASSWORD);
}

export function applyWebPoolWssTarget(chain: MinerChain, url: string): void {
  localStorage.setItem(storageKey(chain, 'kind'), 'stratumPoolWebsocket');
  localStorage.setItem(storageKey(chain, 'stratumPoolWebsocket.url'), url.trim());
}
