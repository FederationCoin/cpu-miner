import type { MinerChain } from './chain';
import type { HostedEndpoints } from './defaults/defaults';
import { STRATUM_PASSWORD } from './miner-api';
import {
  listingStratumWssUrl,
  type FindGroup,
  type ListingPublic,
} from './registry';

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

export function applyWebWssTarget(chain: MinerChain, url: string): void {
  localStorage.setItem(storageKey(chain, 'kind'), 'stratumWebsocket');
  localStorage.setItem(storageKey(chain, 'stratumWebsocket.url'), url.trim());
}

export function housePoolListing(hosted: HostedEndpoints): ListingPublic {
  const parsed = new URL(hosted.stratumWss);
  const path = parsed.pathname || '/stratum';
  return {
    poolId: 'house-testnet',
    chain: 'testnet',
    operatorWallet: '',
    name: hosted.label,
    websiteUrl: 'https://federationcoin.org',
    connect: {
      kind: 'stratumAndDatum',
      stratum: hosted.stratumTcp,
      datum: hosted.datumTcp,
      wss: { host: parsed.host, path },
    },
    coinbaseTag: '',
    listingDomain: 'federationcoin.org',
    attestationCount: 0,
    listerConfirmedCoinbasePayee: false,
    reviewScore: 0,
    hasHostileFlag: false,
  };
}

export function mergeHouseListing(groups: FindGroup[], hosted: HostedEndpoints): FindGroup[] {
  const house = housePoolListing(hosted);
  const url = listingStratumWssUrl(house.connect);
  const exists = groups.some((g) => g.listings.some((l) => listingStratumWssUrl(l.connect) === url));
  if (exists) {
    return groups;
  }
  return [{ domain: house.listingDomain, listings: [house], multipleClaims: false }, ...groups];
}
