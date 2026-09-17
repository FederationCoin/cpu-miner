import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type DatumNotify = {
  jobId: number;
  coinbaseId: number;
  targetByte: number;
  nBits: number;
  version: number;
  height: number;
  ntime8: Uint8Array;
  prevHidden: Uint8Array;
  coinb1: Uint8Array;
  xorKey: Uint8Array;
  xorClear: number;
  extraNonce1: Uint8Array;
};

export type DatumPow = {
  jobId: number;
  coinbaseId: number;
  flags: number;
  targetByte: number;
  ntime8: Uint8Array;
  nonce8: Uint8Array;
  version: number;
  extranonce: Uint8Array;
  username: string;
};

export type DatumClientHandle = {
  connect(): void;
  submitPow(pow: DatumPow): void;
  close(): void;
};

type Ctor = new (
  host: string,
  port: number,
  worker: string,
  handlers: {
    onNotify: (job: DatumNotify) => void;
    onShareResult: (ok: boolean, reason: number) => void;
    onClose: (reason: string) => void;
  },
) => DatumClientHandle;

export async function loadDatumClient(here: string, resourcesPath: string): Promise<Ctor> {
  const paths = [
    join(here, '../../federation-pool/dist/datum/client.js'),
    join(here, '../vendor/federation-pool/datum/client.js'),
    join(resourcesPath, 'federation-pool/datum/client.js'),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      const mod = (await import(pathToFileURL(p).href)) as { DatumClient: Ctor };
      return mod.DatumClient;
    }
  }
  throw new Error('DATUM client not found; build federation-pool');
}
