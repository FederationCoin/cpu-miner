import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { HASHER_HOST } from './hasher-host';
import { NetworkContext } from './network-context';

const POLL_MS = 3000;

@Component({
  selector: 'app-listener-chips',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './listener-chips.html',
  styleUrl: './listener-chips.css',
})
export class ListenerChips implements OnInit {
  private readonly host = inject(HASHER_HOST);
  private readonly network = inject(NetworkContext);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly nodeConnect = signal('');
  protected readonly gatewayConnect = signal('');

  ngOnInit(): void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  async refresh(): Promise<void> {
    const chain = this.network.chain();
    const node = this.host.nodeStatus ? await this.host.nodeStatus({ chain, datadir: '' }) : null;
    this.nodeConnect.set(node?.running && node.connectHost ? `${node.connectHost}:${node.connectPort}` : '');
    const gateway = this.host.gatewayStatus ? await this.host.gatewayStatus({ chain, configPath: '' }) : null;
    this.gatewayConnect.set(
      gateway?.running && gateway.connectHost ? `${gateway.connectHost}:${gateway.connectPort}` : '',
    );
  }

  protected copy(text: string): void {
    void navigator.clipboard?.writeText(text);
  }
}
