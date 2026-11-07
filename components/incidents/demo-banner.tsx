import { isMockIncidentClient } from "@/lib/client";

export function DemoBanner() {
  if (!isMockIncidentClient()) return null;
  return (
    <p className="rounded-xl border border-line bg-panel-raised px-4 py-3 text-sm leading-6 text-muted">
      Demo data. This tab is running a simulated incident. Demo mode does not seal, sign, or verify signatures.
    </p>
  );
}
