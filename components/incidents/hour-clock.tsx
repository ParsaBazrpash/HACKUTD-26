"use client";

import { formatDuration } from "@/lib/time";
import { useBrowserNow } from "@/hooks/use-browser-now";

export function HourClock({ startedAt }: { startedAt: string | null }) {
  const now = useBrowserNow();
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  const elapsed = now === null || Number.isNaN(start) ? null : now - start;

  return (
    <section className="rounded-2xl border border-line bg-panel px-5 py-4" aria-label="Time since discovery">
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted">TIME SINCE DISCOVERY</p>
      <p className="mt-3 font-mono text-3xl tracking-tight text-signal">
        {elapsed === null || elapsed < 0 ? "--:--:--" : formatDuration(elapsed)}
      </p>
      <p className="mt-3 text-sm text-muted">
        {startedAt === null
          ? "No discovery time is on the record. Statutory clocks that start at discovery are not running."
          : elapsed === null
            ? "The elapsed time opens with the browser clock."
            : elapsed < 0
              ? "Discovery time is ahead of this browser clock. A future discovery time does not start a countdown."
              : "Elapsed since the recorded discovery time. The list below is the statute-by-statute result."}
      </p>
    </section>
  );
}
