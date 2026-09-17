import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  DEFAULT_HOSTED_TESTNET,
  HASHER_HOST,
  MINER_SHELL,
  WebHasherHost,
  webDemoShell,
} from '@federationcoin/miner-ui';

const hosted = DEFAULT_HOSTED_TESTNET;

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: MINER_SHELL, useValue: webDemoShell(hosted) },
    { provide: HASHER_HOST, useFactory: () => new WebHasherHost(hosted) },
  ],
};
