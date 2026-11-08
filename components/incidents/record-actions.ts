// Drafts for #record actions. Screens submit these bodies through IncidentClient.
// The client and the module remain the authorization check.

import {
  ASSET_TYPES,
  CSF_CATEGORIES,
  DATA_TYPES,
  isKindAllowed,
  PHASES,
  SCOPE_STATUSES,
  SEVERITIES,
  ScopeBodySchema,
  StatusBodySchema,
  TASK_STATUSES,
  TaskBodySchema,
  TimelineBodySchema,
  type ScopeBody,
  type StatusBody,
  type TaskBody,
  type TimelineBody,
} from "@/lib/protocol/events";
import type { MemberStateName, Role } from "@/spacetimedb/src/shared/policy";

export type RecordKind = "status.set" | "timeline.add" | "scope.set" | "task.set";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDENTITY_HEX = /^[0-9a-f]{64}$/;
const DRAFT_ENTRY_ID = "00000000-0000-4000-8000-000000000001";
const COUNT_MAX = 10_000_000_000;

export type DraftResult<T> = { ok: true; body: T } | { ok: false; reason: string };

export function canAuthorRecord(
  role: Role | undefined,
  memberState: MemberStateName | undefined,
  kind: RecordKind,
): boolean {
  if (!role || memberState !== "active") return false;
  return isKindAllowed(kind, "record", role);
}

export function recordDenial(kind: RecordKind): string {
  if (kind === "status.set") return "Only the commander can change severity and phase.";
  return "Only the commander, counsel, and technical can write the record.";
}

export function toIsoTimestamp(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function toDatetimeLocalValue(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inList(value: string, list: readonly string[]): boolean {
  return list.includes(value);
}

function optionalCount(raw: string, label: string): { ok: true; value?: number } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: `${label} must be a whole number.` };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value > COUNT_MAX) {
    return { ok: false, reason: `${label} is too large.` };
  }
  return { ok: true, value };
}

export interface StatusDraftInput {
  severity: string;
  phase: string;
  summary: string;
}

export function draftStatus(input: StatusDraftInput): DraftResult<StatusBody> {
  if (!inList(input.severity, SEVERITIES)) return { ok: false, reason: "Choose a severity." };
  if (!inList(input.phase, PHASES)) return { ok: false, reason: "Choose a phase." };
  const summary = input.summary.trim();
  if (summary.length > 500) return { ok: false, reason: "The summary is limited to 500 characters." };
  const parsed = StatusBodySchema.safeParse({ severity: input.severity, phase: input.phase, summary });
  if (!parsed.success) return { ok: false, reason: "That update does not match the incident record." };
  return { ok: true, body: parsed.data };
}

export interface TimelineDraftInput {
  occurredAt: string;
  phase: string;
  csf: string;
  text: string;
  amends: string;
}

export function draftTimeline(input: TimelineDraftInput): DraftResult<Omit<TimelineBody, "entryId">> {
  const occurredAt = toIsoTimestamp(input.occurredAt);
  if (!occurredAt) return { ok: false, reason: "Enter when this happened." };
  if (!inList(input.phase, PHASES)) return { ok: false, reason: "Choose a phase." };
  if (!inList(input.csf, CSF_CATEGORIES)) return { ok: false, reason: "Choose a CSF category." };
  const text = input.text.trim();
  if (text.length === 0) return { ok: false, reason: "Enter what happened." };
  if (text.length > 4000) return { ok: false, reason: "Entries are limited to 4000 characters." };
  const amends = input.amends.trim().toLowerCase();
  if (amends && !UUID_V4.test(amends)) {
    return { ok: false, reason: "The entry being amended is not a valid id." };
  }
  const parsed = TimelineBodySchema.safeParse({
    entryId: DRAFT_ENTRY_ID,
    occurredAt,
    phase: input.phase,
    csf: input.csf,
    text,
    ...(amends ? { amends } : {}),
  });
  if (!parsed.success) return { ok: false, reason: "That update does not match the incident record." };
  return {
    ok: true,
    body: {
      occurredAt: parsed.data.occurredAt,
      phase: parsed.data.phase,
      csf: parsed.data.csf,
      text: parsed.data.text,
      ...(parsed.data.amends ? { amends: parsed.data.amends } : {}),
    },
  };
}

export interface ScopeDraftInput {
  itemId: string;
  system: string;
  assetType: string;
  status: string;
  dataTypes: readonly string[];
  recordCount: string;
  euResidents: string;
  affected: readonly { state: string; count: string }[];
  notes: string;
}

export function draftScope(input: ScopeDraftInput): DraftResult<ScopeBody> {
  const itemId = input.itemId.trim().toLowerCase();
  if (!UUID_V4.test(itemId)) return { ok: false, reason: "That id cannot be saved. Start a new entry." };
  const system = input.system.trim();
  if (system.length === 0) return { ok: false, reason: "Enter the system name." };
  if (system.length > 120) return { ok: false, reason: "System names are limited to 120 characters." };
  if (!inList(input.assetType, ASSET_TYPES)) return { ok: false, reason: "Choose an asset type." };
  if (!inList(input.status, SCOPE_STATUSES)) return { ok: false, reason: "Choose a status." };
  const notes = input.notes.trim();
  if (notes.length > 2000) return { ok: false, reason: "Notes are limited to 2000 characters." };

  const dataTypes: ScopeBody["dataTypes"] = [];
  const seenTypes = new Set<string>();
  for (const type of input.dataTypes) {
    if (!inList(type, DATA_TYPES)) return { ok: false, reason: "Unknown data type." };
    if (seenTypes.has(type)) continue;
    seenTypes.add(type);
    dataTypes.push(type as ScopeBody["dataTypes"][number]);
  }

  const recordCount = optionalCount(input.recordCount, "Record count");
  if (!recordCount.ok) return recordCount;
  const euResidents = optionalCount(input.euResidents, "EU resident count");
  if (!euResidents.ok) return euResidents;

  const affected: ScopeBody["affected"] = [];
  const seenStates = new Set<string>();
  for (const row of input.affected) {
    const state = row.state.trim().toUpperCase();
    const countRaw = row.count.trim();
    if (!state && !countRaw) continue;
    if (!/^[A-Z]{2}$/.test(state)) {
      return { ok: false, reason: "Affected regions use a two-letter code such as TX." };
    }
    if (seenStates.has(state)) return { ok: false, reason: "Each region can be listed once." };
    const count = optionalCount(countRaw, "Resident count");
    if (!count.ok) return count;
    if (count.value === undefined) return { ok: false, reason: "Each affected region needs a resident count." };
    seenStates.add(state);
    affected.push({ state, count: count.value });
  }
  if (affected.length > 60) return { ok: false, reason: "Record at most 60 regions." };

  const parsed = ScopeBodySchema.safeParse({
    itemId,
    system,
    assetType: input.assetType,
    status: input.status,
    dataTypes,
    affected,
    notes,
    ...(recordCount.value !== undefined ? { recordCount: recordCount.value } : {}),
    ...(euResidents.value !== undefined ? { euResidents: euResidents.value } : {}),
  });
  if (!parsed.success) return { ok: false, reason: "That update does not match the incident record." };
  return { ok: true, body: parsed.data };
}

export interface TaskDraftInput {
  taskId: string;
  title: string;
  assignee: string;
  dueAt: string;
  status: string;
}

export function draftTask(input: TaskDraftInput): DraftResult<TaskBody> {
  const taskId = input.taskId.trim().toLowerCase();
  if (!UUID_V4.test(taskId)) return { ok: false, reason: "That id cannot be saved. Start a new task." };
  const title = input.title.trim();
  if (title.length === 0) return { ok: false, reason: "Enter a task." };
  if (title.length > 200) return { ok: false, reason: "Tasks are limited to 200 characters." };
  if (!inList(input.status, TASK_STATUSES)) return { ok: false, reason: "Choose a task status." };
  const assignee = input.assignee.trim().toLowerCase();
  if (assignee && !IDENTITY_HEX.test(assignee)) {
    return { ok: false, reason: "Choose an assignee from the room." };
  }
  const dueRaw = input.dueAt.trim();
  const dueAt = dueRaw ? toIsoTimestamp(dueRaw) : null;
  if (dueRaw && !dueAt) return { ok: false, reason: "Enter a valid due time." };

  const parsed = TaskBodySchema.safeParse({
    taskId,
    title,
    status: input.status,
    ...(assignee ? { assignee } : {}),
    ...(dueAt ? { dueAt } : {}),
  });
  if (!parsed.success) return { ok: false, reason: "That update does not match the incident record." };
  return { ok: true, body: parsed.data };
}
