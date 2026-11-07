import type { IntegrityReport } from "@/lib/client/types";

function firstFailure(report: IntegrityReport): { channel: string; seq: bigint } | null {
  for (const [channel, integrity] of Object.entries(report.channels)) {
    const hit = integrity?.failures[0];
    if (hit) return { channel, seq: hit.seq };
  }
  return null;
}

export function IntegrityMark({ report, mock }: { report: IntegrityReport; mock: boolean }) {
  const failure = firstFailure(report);
  if (!report.ok && failure) {
    return (
      <span className="font-mono text-[11px] tracking-wide text-alert">
        Integrity failure: #{failure.channel} seq {failure.seq.toString()}
      </span>
    );
  }
  if (!report.ok) {
    return <span className="font-mono text-[11px] tracking-wide text-alert">Integrity failure</span>;
  }
  if (mock) {
    return (
      <span className="font-mono text-[11px] tracking-wide text-muted">
        Demo sequence check passed. Signatures are not verified.
      </span>
    );
  }
  return <span className="font-mono text-[11px] tracking-wide text-verified">Integrity checked</span>;
}
