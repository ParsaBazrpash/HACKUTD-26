import type { IncidentState } from "@/lib/client/types";

export type IncidentAccessPhase = "loading" | "denied" | "error" | "ready";

export interface IncidentAccess {
  phase: IncidentAccessPhase;
  message: string;
}

/** Shared gate for the legal page and the report. Revoked and pending members see no incident content. */
export function incidentAccess(state: IncidentState): IncidentAccess {
  const membership = state.me?.state;
  if (membership === "revoked" || membership === "pending") {
    return { phase: "denied", message: "You do not have access to this incident." };
  }
  if (!state.incident || !state.me || membership !== "active") {
    if (state.connection === "error") {
      return {
        phase: "error",
        message: cleanError(state.error),
      };
    }
    return { phase: "loading", message: "Opening the incident…" };
  }
  return { phase: "ready", message: "" };
}

function cleanError(error: string | undefined): string {
  const message = error?.trim() ?? "";
  if (!message || message.length > 240 || /[\r\n]/.test(message)) {
    return "The incident client could not open this incident.";
  }
  return message;
}
