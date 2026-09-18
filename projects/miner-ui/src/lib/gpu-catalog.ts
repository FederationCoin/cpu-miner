export type GpuStrategy =
  | { kind: 'cuda'; index: number }
  | { kind: 'opencl'; platform: number; device: number }
  | { kind: 'webgpu'; adapter: 0 };

export type NativeGpuDevice =
  | {
      kind: 'cuda';
      index: number;
      id: string;
      name: string;
      vendor: string;
      memoryMiB: number;
      deviceKind: 'discrete' | 'integrated';
    }
  | {
      kind: 'opencl';
      platform: number;
      device: number;
      id: string;
      name: string;
      vendor: string;
      memoryMiB: number;
      deviceKind: 'discrete' | 'integrated';
    };

export type WebGpuDevice = {
  kind: 'webgpu';
  adapter: 0;
  name: string;
  vendor: string;
};

export type GpuAdapter = {
  key: string;
  label: string;
  memoryMiB: number;
  deviceKind: 'discrete' | 'integrated';
  strategies: GpuStrategy[];
};

export type GpuPick = { adapter: string; strategy: GpuStrategy };

const STRATEGY_ORDER: Record<GpuStrategy['kind'], number> = {
  webgpu: 0,
  cuda: 1,
  opencl: 2,
};

export function normalizeGpuLabel(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function strategyKindLabel(kind: GpuStrategy['kind']): string {
  if (kind === 'webgpu') {
    return 'WebGPU';
  }
  if (kind === 'cuda') {
    return 'CUDA';
  }
  return 'OpenCL';
}

export function isGpuStrategy(raw: unknown): raw is GpuStrategy {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const rec = raw as { kind?: unknown; index?: unknown; platform?: unknown; device?: unknown; adapter?: unknown };
  if (rec.kind === 'cuda') {
    return Number.isInteger(rec.index) && (rec.index as number) >= 0;
  }
  if (rec.kind === 'opencl') {
    return (
      Number.isInteger(rec.platform) &&
      (rec.platform as number) >= 0 &&
      Number.isInteger(rec.device) &&
      (rec.device as number) >= 0
    );
  }
  if (rec.kind === 'webgpu') {
    return rec.adapter === 0;
  }
  return false;
}

export function parseGpuPicks(raw: unknown): GpuPick[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: GpuPick[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const rec = item as { adapter?: unknown; strategy?: unknown };
    if (typeof rec.adapter !== 'string' || !rec.adapter.trim() || !isGpuStrategy(rec.strategy)) {
      continue;
    }
    out.push({ adapter: rec.adapter, strategy: rec.strategy });
  }
  return out;
}

export function adapterHasStrategy(adapter: GpuAdapter, strategy: GpuStrategy): boolean {
  return adapter.strategies.some((s) => sameStrategy(s, strategy));
}

export function sameStrategy(a: GpuStrategy, b: GpuStrategy): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'cuda' && b.kind === 'cuda') {
    return a.index === b.index;
  }
  if (a.kind === 'opencl' && b.kind === 'opencl') {
    return a.platform === b.platform && a.device === b.device;
  }
  return a.kind === 'webgpu' && b.kind === 'webgpu';
}

export function pickForAdapter(picks: GpuPick[], adapterKey: string): GpuPick | undefined {
  return picks.find((p) => p.adapter === adapterKey);
}

export function setAdapterPick(picks: GpuPick[], adapterKey: string, strategy: GpuStrategy | null): GpuPick[] {
  const next = picks.filter((p) => p.adapter !== adapterKey);
  if (strategy) {
    next.push({ adapter: adapterKey, strategy });
  }
  return next;
}

export function liveGpuPicks(picks: GpuPick[], adapters: GpuAdapter[]): GpuPick[] {
  return picks.filter((p) => {
    const adapter = adapters.find((a) => a.key === p.adapter);
    return adapter ? adapterHasStrategy(adapter, p.strategy) : false;
  });
}

export function migrateGpuIds(ids: string[], adapters: GpuAdapter[]): GpuPick[] {
  const picks: GpuPick[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) {
      continue;
    }
    if (id === 'webgpu:0' || id.startsWith('webgpu:')) {
      const adapter = adapters.find((a) => a.strategies.some((s) => s.kind === 'webgpu'));
      if (adapter) {
        picks.push({ adapter: adapter.key, strategy: { kind: 'webgpu', adapter: 0 } });
      }
      continue;
    }
    const cuda = /^cuda:(\d+):/.exec(id);
    if (cuda) {
      const index = Number(cuda[1]);
      const adapter = adapters.find((a) => a.strategies.some((s) => s.kind === 'cuda' && s.index === index));
      if (adapter) {
        picks.push({ adapter: adapter.key, strategy: { kind: 'cuda', index } });
      }
      continue;
    }
    const ocl = /^opencl:(\d+):(\d+):/.exec(id);
    if (ocl) {
      const platform = Number(ocl[1]);
      const device = Number(ocl[2]);
      const adapter = adapters.find((a) =>
        a.strategies.some((s) => s.kind === 'opencl' && s.platform === platform && s.device === device),
      );
      if (adapter) {
        picks.push({ adapter: adapter.key, strategy: { kind: 'opencl', platform, device } });
      }
    }
  }
  return liveGpuPicks(picks, adapters);
}

type Row = GpuAdapter & { slot: number };

export function groupGpuAdapters(native: NativeGpuDevice[], web: WebGpuDevice[]): GpuAdapter[] {
  const byLabel = new Map<string, Row[]>();

  const rowsFor = (label: string): Row[] => {
    const key = normalizeGpuLabel(label);
    let list = byLabel.get(key);
    if (!list) {
      list = [];
      byLabel.set(key, list);
    }
    return list;
  };

  for (const d of native) {
    if (d.kind !== 'cuda') {
      continue;
    }
    const list = rowsFor(d.name);
    list.push({
      key: '',
      label: d.name,
      memoryMiB: d.memoryMiB,
      deviceKind: d.deviceKind,
      strategies: [{ kind: 'cuda', index: d.index }],
      slot: list.length,
    });
  }

  for (const d of native) {
    if (d.kind !== 'opencl') {
      continue;
    }
    const list = rowsFor(d.name);
    const free = list.find((r) => !r.strategies.some((s) => s.kind === 'opencl'));
    if (free) {
      free.strategies.push({ kind: 'opencl', platform: d.platform, device: d.device });
      if (d.memoryMiB > free.memoryMiB) {
        free.memoryMiB = d.memoryMiB;
      }
    } else {
      list.push({
        key: '',
        label: d.name,
        memoryMiB: d.memoryMiB,
        deviceKind: d.deviceKind,
        strategies: [{ kind: 'opencl', platform: d.platform, device: d.device }],
        slot: list.length,
      });
    }
  }

  for (const d of web) {
    const list = rowsFor(d.name);
    const free = list.find((r) => !r.strategies.some((s) => s.kind === 'webgpu'));
    if (free) {
      free.strategies.push({ kind: 'webgpu', adapter: 0 });
    } else {
      list.push({
        key: '',
        label: d.name,
        memoryMiB: 0,
        deviceKind: 'discrete',
        strategies: [{ kind: 'webgpu', adapter: 0 }],
        slot: list.length,
      });
    }
  }

  const out: GpuAdapter[] = [];
  for (const list of byLabel.values()) {
    const multi = list.length > 1;
    for (const row of list) {
      const base = normalizeGpuLabel(row.label);
      row.strategies.sort((a, b) => STRATEGY_ORDER[a.kind] - STRATEGY_ORDER[b.kind]);
      out.push({
        key: multi ? `${base}#${row.slot}` : base,
        label: row.label,
        memoryMiB: row.memoryMiB,
        deviceKind: row.deviceKind,
        strategies: row.strategies,
      });
    }
  }
  return out;
}

export function catalogHasWebGpu(adapters: GpuAdapter[]): boolean {
  return adapters.some((a) => a.strategies.some((s) => s.kind === 'webgpu'));
}
