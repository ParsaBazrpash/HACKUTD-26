// How a state's verified resident counts become a color on the exposure globe.
// Counts come from the incident record. A state with none stays neutral.

import { exposureStep } from "@/components/incidents/blast-radius-model";

export const SCALE_BANDS = ["none", "low", "moderate", "high", "critical"] as const;
export type ScaleBand = (typeof SCALE_BANDS)[number];
export type ExposureBand = ScaleBand | "outside";

const STEP_BAND: readonly ScaleBand[] = SCALE_BANDS;

export function exposureBand(exposed: number, other = 0): ExposureBand {
  const step = exposureStep(exposed);
  if (step === 0 && other > 0) return "outside";
  return STEP_BAND[step] ?? "none";
}

/** Fills stay muted. Only hover and selection add light, and only on that state. */
export const BAND_FILL: Record<ExposureBand, string> = {
  none: "#1a201c",
  low: "#4e5638",
  moderate: "#8fb34a",
  high: "#b08a3e",
  critical: "#c97a74",
  outside: "#3e4a3a",
};

export const BAND_LABEL: Record<ExposureBand, string> = {
  none: "No exposure",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Critical",
  outside: "Outside the blast radius",
};

export const BAND_SCALE: Record<ScaleBand, string> = {
  none: "None",
  low: "Low, under 250",
  moderate: "Moderate, under 1,000",
  high: "High, under 10,000",
  critical: "Critical, 10,000 or more",
};

const STATUS_RANK = ["exfiltrated", "encrypted", "suspected", "unknown", "contained", "eradicated", "restored"];

/** Worst status among the systems tied to a state. Null when the record has none. */
export function leadingStatus(statuses: readonly string[]): string | null {
  let best: string | null = null;
  let rank = Number.POSITIVE_INFINITY;
  for (const status of statuses) {
    if (typeof status !== "string" || status.length === 0) continue;
    const index = STATUS_RANK.indexOf(status);
    const next = index === -1 ? STATUS_RANK.length : index;
    if (next < rank) {
      rank = next;
      best = status;
    }
  }
  return best;
}
