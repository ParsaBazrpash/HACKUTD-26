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
      <h1 className="mt-3 text-4xl font-medium tracking-tight">The page failed to render.</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
        Incident contents stay in this browser. You can try again.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-muted">Digest {error.digest}.</p> : null}
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex rounded-lg bg-signal px-4 py-2 text-sm font-medium text-signal-ink hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        Try again
      </button>
    </Main>
  );
}
