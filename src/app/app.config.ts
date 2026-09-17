import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ElectronHasherHost, HASHER_HOST, desktopShell, MINER_SHELL } from '@federationcoin/miner-ui';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: HASHER_HOST, useClass: ElectronHasherHost },
    { provide: MINER_SHELL, useValue: desktopShell() },
  ],
};
