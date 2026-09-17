import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  HASHER_HOST,
  MINER_SHELL,
  WEB_DEFAULTS,
  WebHasherHost,
  webDemoShell,
} from '@federationcoin/miner-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: MINER_SHELL, useValue: webDemoShell() },
    { provide: HASHER_HOST, useFactory: () => new WebHasherHost(WEB_DEFAULTS.hosted) },
  ],
};
