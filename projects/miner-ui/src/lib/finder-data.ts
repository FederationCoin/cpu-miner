export type PoolListing = {
  id: string;
  name: string;
  tag: string;
  stratum: string;
  datum: string;
  hashrateHint: string;
  verified: boolean;
  house: boolean;
};

export const HOUSE_TESTNET_POOL: PoolListing = {
  id: 'house-testnet',
  name: 'FederationCoin testnet pool',
  tag: '/FederationCoin/',
  stratum: 'stratum.testnet.federationcoin.org:23334',
  datum: 'datum.testnet.federationcoin.org:28916',
  hashrateHint: 'House demo. Not the pool of record.',
  verified: false,
  house: true,
};

export const EMPTY_POOL_SLOTS: PoolListing[] = [
  {
    id: 'slot-2',
    name: 'Empty slot',
    tag: '—',
    stratum: '—',
    datum: '—',
    hashrateHint: 'Register is a stub. A form post is not proof.',
    verified: false,
    house: false,
  },
  {
    id: 'slot-3',
    name: 'Empty slot',
    tag: '—',
    stratum: '—',
    datum: '—',
    hashrateHint: 'Register is a stub. A form post is not proof.',
    verified: false,
    house: false,
  },
];

export const CURATED_POOLS: PoolListing[] = [HOUSE_TESTNET_POOL, ...EMPTY_POOL_SLOTS];
