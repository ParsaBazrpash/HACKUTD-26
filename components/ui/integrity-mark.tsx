import type { Integrity } from "@/types/common";

export function IntegrityMark({ integrity }: { integrity: Integrity }) {
  const label =
    integrity.status === "verified" && integrity.source === "browser-verified"
      ? "Verified in browser"
      : integrity.status === "failed"
        ? "Check failed"
        : integrity.status === "unverified"
          ? "Unverified"
          : "Integrity unknown";

  const tone =
    integrity.status === "verified"
      ? "text-verified"
      : integrity.status === "failed"
        ? "text-alert"
        : "text-muted";

  return <span className={`font-mono text-[11px] tracking-wide ${tone}`}>{label}</span>;
}
