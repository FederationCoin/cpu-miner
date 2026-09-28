export type ListenReach = 'computer' | 'network';

export function parseListenReach(raw: unknown): ListenReach {
  return raw === 'network' ? 'network' : 'computer';
}

export function listenBindAddr(reach: ListenReach): '127.0.0.1' | '0.0.0.0' {
  return reach === 'network' ? '0.0.0.0' : '127.0.0.1';
}

type Ipv4Iface = { address: string; family: string | number; internal: boolean };

export function privateIpv4(ifaces: Record<string, Ipv4Iface[] | undefined>): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const addr of list ?? []) {
      const v4 = addr.family === 'IPv4' || addr.family === 4;
      if (v4 && !addr.internal && isPrivateIpv4(addr.address)) {
        out.push(addr.address);
      }
    }
  }
  return out;
}

export function connectHostForReach(reach: ListenReach, addresses: string[]): string {
  if (reach === 'computer') {
    return '127.0.0.1';
  }
  return addresses[0] ?? '127.0.0.1';
}

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith('10.') || address.startsWith('192.168.')) {
    return true;
  }
  const parts = address.split('.');
  if (parts[0] !== '172') {
    return false;
  }
  const second = Number(parts[1]);
  return second >= 16 && second <= 31;
}
