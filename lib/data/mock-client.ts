import { projectLegalDeadlines } from "@/lib/legal";
import { fixtureEnvelope } from "@/lib/data/fixtures";
import { assertNoSensitiveFields, assertPrototypeFixtures } from "@/lib/data/sensitive";
import {
  UnknownIncidentError,
  type IncidentDataClient,
  type IncidentSnapshot,
} from "@/lib/data/client";
import { UNSET_INTEGRITY } from "@/types/common";
import {
  affectedAssetShellSchema,
  channelShellSchema,
  incidentEventShellSchema,
  incidentShellSchema,
  joinIncidentInputSchema,
  memberShellSchema,
  taskShellSchema,
  type AffectedAssetShell,
  type ChannelShell,
  type IncidentEventShell,
  type IncidentShell,
  type JoinIncidentInput,
  type MemberShell,
  type TaskShell,
} from "@/types/shells";

interface MockSeed {
  incidents: IncidentShell[];
  members: MemberShell[];
  channels: ChannelShell[];
  events: IncidentEventShell[];
  tasks: TaskShell[];
  assets: AffectedAssetShell[];
}

function createSeed(): MockSeed {
  const brief = (label: string) => fixtureEnvelope("fixture-key", label);

  const seed: MockSeed = {
    incidents: [
      incidentShellSchema.parse({
        id: "inc_harbor",
        status: "active",
        startedAt: "2026-11-07T14:12:00.000Z",
        sealedBrief: brief("harbor-brief"),
        integrity: UNSET_INTEGRITY,
      }),
      incidentShellSchema.parse({
        id: "inc_kiln",
        status: "contained",
        startedAt: "2026-11-06T09:00:00.000Z",
        sealedBrief: brief("kiln-brief"),
        integrity: UNSET_INTEGRITY,
      }),
    ],
    members: [
      ["mem_harbor_cmd", "inc_harbor", "incident_commander", "2026-11-07T14:12:00.000Z"],
      ["mem_harbor_legal", "inc_harbor", "legal_counsel", "2026-11-07T14:18:00.000Z"],
      ["mem_harbor_forensics", "inc_harbor", "forensic_investigator", "2026-11-07T14:21:00.000Z"],
      ["mem_harbor_exec", "inc_harbor", "executive", "2026-11-07T14:26:00.000Z"],
      ["mem_kiln_cmd", "inc_kiln", "incident_commander", "2026-11-06T09:00:00.000Z"],
      ["mem_kiln_legal", "inc_kiln", "legal_counsel", "2026-11-06T09:20:00.000Z"],
    ].map(([id, incidentId, role, joinedAt]) =>
      memberShellSchema.parse({
        id,
        incidentId,
        role,
        joinedAt,
        publicKeyId: null,
        integrity: UNSET_INTEGRITY,
      }),
    ),
    channels: [
      ["chan_harbor_command", "inc_harbor", "command", "2026-11-07T14:12:00.000Z"],
      ["chan_harbor_legal", "inc_harbor", "legal", "2026-11-07T14:12:00.000Z"],
      ["chan_harbor_forensics", "inc_harbor", "forensics", "2026-11-07T14:12:00.000Z"],
      ["chan_harbor_executive", "inc_harbor", "executive", "2026-11-07T14:12:00.000Z"],
      ["chan_kiln_command", "inc_kiln", "command", "2026-11-06T09:00:00.000Z"],
      ["chan_kiln_legal", "inc_kiln", "legal", "2026-11-06T09:00:00.000Z"],
    ].map(([id, incidentId, kind, createdAt]) =>
      channelShellSchema.parse({
        id,
        incidentId,
        kind,
        createdAt,
        sealedTopic: brief(`${id}-topic`),
      }),
    ),
    events: [
      incidentEventShellSchema.parse({
        id: "evt_harbor_1",
        incidentId: "inc_harbor",
        channelId: "chan_harbor_command",
        authorMemberId: "mem_harbor_cmd",
        createdAt: "2026-11-07T14:40:00.000Z",
        sealedBody: brief("harbor-event-1"),
        integrity: UNSET_INTEGRITY,
      }),
    ],
    tasks: [
      taskShellSchema.parse({
        id: "task_harbor_1",
        incidentId: "inc_harbor",
        status: "in_progress",
        assigneeMemberId: "mem_harbor_forensics",
        dueAt: "2026-11-08T18:00:00.000Z",
        sealedDetails: brief("harbor-task-1"),
      }),
      taskShellSchema.parse({
        id: "task_harbor_2",
        incidentId: "inc_harbor",
        status: "open",
        assigneeMemberId: "mem_harbor_legal",
        dueAt: null,
        sealedDetails: brief("harbor-task-2"),
      }),
      taskShellSchema.parse({
        id: "task_kiln_1",
        incidentId: "inc_kiln",
        status: "done",
        assigneeMemberId: "mem_kiln_cmd",
        dueAt: null,
        sealedDetails: brief("kiln-task-1"),
      }),
    ],
    assets: [
      affectedAssetShellSchema.parse({
        id: "asset_harbor_1",
        incidentId: "inc_harbor",
        kind: "endpoint",
        sealedDescriptor: brief("harbor-asset-1"),
        integrity: UNSET_INTEGRITY,
      }),
      affectedAssetShellSchema.parse({
        id: "asset_harbor_2",
        incidentId: "inc_harbor",
        kind: "identity",
        sealedDescriptor: brief("harbor-asset-2"),
        integrity: UNSET_INTEGRITY,
      }),
    ],
  };

  assertNoSensitiveFields(seed);
  assertPrototypeFixtures(seed);
  return seed;
}

export interface MockClientOptions {
  now?: () => Date;
}

export function createMockIncidentDataClient(
  options: MockClientOptions = {},
): IncidentDataClient {
  const seed = createSeed();
  const incidents = seed.incidents;
  let members = seed.members;
  let memberSeq = 0;
  const channels = seed.channels;
  const events = seed.events;
  const tasks = seed.tasks;
  const assets = seed.assets;
  let publishedList: readonly IncidentShell[] = incidents;
  const listeners = new Set<() => void>();

  const emit = () => {
    publishedList = [...incidents];
    for (const listener of listeners) listener();
  };

  const client: IncidentDataClient = {
    mode: "mock",
    getIncidentList() {
      return publishedList;
    },
    getSnapshot(incidentId: string, clock?: Date): IncidentSnapshot | null {
      const incident = incidents.find((item) => item.id === incidentId);
      if (!incident) return null;

      const snapshot: IncidentSnapshot = {
        incident,
        members: members.filter((member) => member.incidentId === incidentId),
        channels: channels.filter((channel) => channel.incidentId === incidentId),
        events: events
          .filter((event) => event.incidentId === incidentId)
          .slice()
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
        tasks: tasks.filter((task) => task.incidentId === incidentId),
        assets: assets.filter((asset) => asset.incidentId === incidentId),
        legalDeadlines: clock
          ? projectLegalDeadlines({
              incidentId,
              awarenessAt: incident.startedAt,
              now: clock,
            })
          : [],
      };

      assertNoSensitiveFields(snapshot);
      assertPrototypeFixtures(snapshot);
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async joinIncident(input: JoinIncidentInput): Promise<MemberShell> {
      const parsed = joinIncidentInputSchema.parse(input);
      if (!incidents.some((incident) => incident.id === parsed.incidentId)) {
        throw new UnknownIncidentError(parsed.incidentId);
      }

      memberSeq += 1;
      const member = memberShellSchema.parse({
        id: `mem_join_${String(memberSeq).padStart(3, "0")}`,
        incidentId: parsed.incidentId,
        role: parsed.role,
        joinedAt: (options.now ? options.now() : new Date()).toISOString(),
        publicKeyId: parsed.publicKeyId ?? null,
        integrity: UNSET_INTEGRITY,
      });

      assertNoSensitiveFields(member);
      members = [...members, member];
      emit();
      return member;
    },
  };

  return client;
}
