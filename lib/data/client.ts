import type { LegalDeadline } from "@/types/legal";
import type {
  AffectedAssetShell,
  ChannelShell,
  IncidentEventShell,
  IncidentShell,
  JoinIncidentInput,
  MemberShell,
  TaskShell,
} from "@/types/shells";

export interface IncidentSnapshot {
  incident: IncidentShell;
  members: MemberShell[];
  channels: ChannelShell[];
  events: IncidentEventShell[];
  tasks: TaskShell[];
  assets: AffectedAssetShell[];
  legalDeadlines: LegalDeadline[];
}

/**
 * Local cache API shared by the in-memory prototype and the future
 * SpacetimeDB subscription. Reads return sealed shells. They do not
 * accept or return incident plaintext.
 *
 * `getSnapshot` and `getIncidentList` are synchronous because a
 * SpacetimeDB subscription cache is local. They must not perform network IO.
 */
export interface IncidentDataClient {
  readonly mode: "mock" | "spacetimedb";
  getIncidentList(): readonly IncidentShell[];
  /**
   * Local cache read. Pass `clock` to project notice deadlines.
   * Omit it during render. `new Date()` is not a stable prerender value.
   */
  getSnapshot(incidentId: string, clock?: Date): IncidentSnapshot | null;
  subscribe(listener: () => void): () => void;
  joinIncident(input: JoinIncidentInput): Promise<MemberShell>;
}

export class UnknownIncidentError extends Error {
  constructor(incidentId: string) {
    super(`No incident shell is available for ${incidentId}.`);
    this.name = "UnknownIncidentError";
  }
}

export class SpacetimeModuleNotReadyError extends Error {
  constructor() {
    super("SpacetimeDB module is not connected. No incident data was sent.");
    this.name = "SpacetimeModuleNotReadyError";
  }
}

export class InvalidSpacetimeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSpacetimeTargetError";
  }
}
