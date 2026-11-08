// Round-trip timing for this device's own writes to Spacetime.
//
// A sample is the time from sending an already encrypted and signed event to
// the reducer result coming back. The Spacetime SDK applies the new rows to
// the local cache before that result resolves. It is this device's own round
// trip: other members get the same commit, but after their own network delay.
// It holds timings only, never content.

export interface SyncSample {
  ms: number;
  at: number;
  channel: string;
}

const MAX_SAMPLES = 20;
let samples: SyncSample[] = [];
// Counts every sample ever recorded. It only goes up, so a caller can tell a
// new sample arrived even once the kept list is full.
let recorded = 0;
const listeners = new Set<() => void>();

export function recordSync(ms: number, channel: string, at = Date.now()): void {
  if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) return;
  samples = [...samples, { ms: Math.round(ms), at, channel }].slice(-MAX_SAMPLES);
  recorded += 1;
  for (const listener of [...listeners]) listener();
}

export function syncSamples(): readonly SyncSample[] {
  return samples;
}

/** How many samples were ever recorded. Take it before a write, then pass it to syncSampleSince. */
export function syncCount(): number {
  return recorded;
}

/** The newest sample when one was recorded after `mark` (a syncCount() value), otherwise null. */
export function syncSampleSince(mark: number): SyncSample | null {
  return recorded > mark && samples.length > 0 ? samples[samples.length - 1] : null;
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
