// Round-trip timing for this device's own writes to Spacetime.
//
// A sample is the time from sending an already encrypted and signed event to
// the reducer result coming back. The Spacetime SDK applies the new rows to
// the local cache before that result resolves, and the same commit is pushed
// to every other subscriber, so this is the honest "your change is live" time
// as seen from this device. It holds timings only, never content.

export interface SyncSample {
  ms: number;
  at: number;
  channel: string;
}

const MAX_SAMPLES = 20;
let samples: SyncSample[] = [];
const listeners = new Set<() => void>();

export function recordSync(ms: number, channel: string, at = Date.now()): void {
  if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) return;
  samples = [...samples, { ms: Math.round(ms), at, channel }].slice(-MAX_SAMPLES);
  for (const listener of [...listeners]) listener();
}

export function syncSamples(): readonly SyncSample[] {
  return samples;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Median of the kept samples, or null when there are none. */
export function medianSync(list: readonly SyncSample[]): number | null {
  if (list.length === 0) return null;
  const sorted = list.map((s) => s.ms).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Test helper. */
export function resetSyncSamples(): void {
  samples = [];
  for (const listener of [...listeners]) listener();
}
