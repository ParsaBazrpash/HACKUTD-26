import { describeVerdict } from "@/components/incidents/situation";
import type { Verdict } from "@/lib/client/types";

export function VerdictNote({ verdict }: { verdict: Verdict }) {
  const text = describeVerdict(verdict);
  if (!text) return null;
  return <p className="mt-1 text-xs text-alert">{text}</p>;
}
