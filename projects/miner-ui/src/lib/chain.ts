/** Renderer chain configs. Dummy MAIN RPC 4094 / HRP gfcn match chainparamsbase. */

export type MinerChain = 'main' | 'testnet';

export type ChainConfig = {
  id: MinerChain;
  label: string;
  hrp: 'gfcn' | 'tgfcn';
  rpcPort: number;
  stratumPort: number;
  datumPort: number;
  cookieSubdir: string;
  /** false until announcement. Flip in golive (Miner when MAIN is restored). */
  mainIsLive: boolean;
};

export const CHAINS: Record<MinerChain, ChainConfig> = {
  main: {
    id: 'main',
    label: 'Main',
    hrp: 'gfcn',
    rpcPort: 4094,
    stratumPort: 23334,
    datumPort: 28916,
    cookieSubdir: '',
    mainIsLive: false,
  },
  testnet: {
    id: 'testnet',
    label: 'Testnet',
    hrp: 'tgfcn',
    rpcPort: 35332,
    stratumPort: 23334,
    datumPort: 28916,
    cookieSubdir: 'testnet3',
    mainIsLive: true,
  },
};

export function chainConfig(id: MinerChain): ChainConfig {
  return CHAINS[id];
}
