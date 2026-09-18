export type GpuStrategy =
  | { kind: 'cuda'; index: number }
  | { kind: 'opencl'; platform: number; device: number }
  | { kind: 'webgpu'; adapter: 0 };

export type GpuPick = { adapter: string; strategy: GpuStrategy };

function isStrategy(raw: unknown): raw is GpuStrategy {
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
    if (typeof rec.adapter !== 'string' || !rec.adapter.trim() || !isStrategy(rec.strategy)) {
      continue;
    }
    out.push({ adapter: rec.adapter, strategy: rec.strategy });
  }
  return out;
}

export function nativeGpuPicks(picks: GpuPick[]): GpuPick[] {
  return picks.filter((p) => p.strategy.kind === 'cuda' || p.strategy.kind === 'opencl');
}

export function webGpuPicks(picks: GpuPick[]): GpuPick[] {
  return picks.filter((p) => p.strategy.kind === 'webgpu');
}
