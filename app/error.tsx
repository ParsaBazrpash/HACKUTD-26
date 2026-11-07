"use client";

import { Main } from "@/components/shell/main";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Main>
      <p className="font-mono text-[11px] tracking-[0.18em] text-alert">SHELL ERROR</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight">The shell failed to render.</h1>
      <p className="mt-3 text-sm text-muted">
        {error.digest ? `Digest ${error.digest}.` : "An unexpected error occurred."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex rounded-full bg-signal px-4 py-2 text-sm font-medium text-signal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        Try again
      </button>
    </Main>
  );
}
