import {
  InvalidSpacetimeTargetError,
  SpacetimeModuleNotReadyError,
  type IncidentDataClient,
  type IncidentSnapshot,
} from "@/lib/data/client";
import type { IncidentShell, MemberShell } from "@/types/shells";

export interface SpacetimeTarget {
  uri: string;
  database: string;
}

/**
 * Same interface as the prototype client. Every call refuses.
 * Connecting here before the module exists would pretend data was synced.
 */
export class SpacetimeDbIncidentClient implements IncidentDataClient {
  readonly mode = "spacetimedb" as const;

  constructor(target: SpacetimeTarget) {
    if (!target.uri.startsWith("wss://") && !target.uri.startsWith("ws://")) {
      throw new InvalidSpacetimeTargetError("SpacetimeDB URI must start with ws:// or wss://.");
    }
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(target.database)) {
      throw new InvalidSpacetimeTargetError("SpacetimeDB database name is missing or invalid.");
    }
    this.target = target;
  }

  /** Retained for the future subscription. Not used to send data. */
  readonly target: SpacetimeTarget;

  getIncidentList(): readonly IncidentShell[] {
    throw new SpacetimeModuleNotReadyError();
  }

  getSnapshot(): IncidentSnapshot | null {
    throw new SpacetimeModuleNotReadyError();
  }

  subscribe(): () => void {
    throw new SpacetimeModuleNotReadyError();
  }

  async joinIncident(): Promise<MemberShell> {
    throw new SpacetimeModuleNotReadyError();
  }
}
