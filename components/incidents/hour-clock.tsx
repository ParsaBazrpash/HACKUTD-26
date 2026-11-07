"use client";

import { formatDuration, SEVENTY_TWO_HOURS_MS } from "@/lib/time";
import { useBrowserNow } from "@/hooks/use-browser-now";

export function HourClock({ startedAt }: { startedAt: string }) {
  const now = useBrowserNow();
  const start = Date.parse(startedAt);
  const elapsed = now === null || Number.isNaN(start) ? null : now - start;
  const remaining = elapsed === null ? null : SEVENTY_TWO_HOURS_MS - elapsed;

  return (
    <section className="rounded-2xl border border-line bg-panel px-5 py-4" aria-label="72 hour window">
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted">72-HOUR WINDOW</p>
      <p className="mt-3 font-mono text-4xl tracking-tight text-signal sm:text-5xl">
        {remaining === null ? "--:--:--" : formatDuration(remaining)}
      </p>
      <p className="mt-3 text-sm text-muted">
        {elapsed === null
          ? "The clock starts in the browser."
          : elapsed < 0
            ? "Awareness time is ahead of this browser clock."
            : `${formatDuration(elapsed)} since the recorded awareness time.`}
      </p>
    </section>
  );
}
