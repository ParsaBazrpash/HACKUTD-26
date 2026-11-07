// Event payload kinds (docs/PLAN.md 4.8). Client only.
//
// Everything here is validated with zod after decryption. Every string has a
// maximum length and every array a maximum size. Objects are strict: unknown
// fields make a payload invalid, and the verifier flags (never drops) it.
// Frozen after Sync 1.

import { z } from 'zod';
import { canWrite, CHANNELS, type ChannelKind, type Role, ROLES } from '@/spacetimedb/src/shared/policy';

export const PAYLOAD_VERSION = 1;

// --- Enums -----------------------------------------------------------------

export const PHASES = [
  'preparation',
  'detection_analysis',
  'containment',
  'eradication',
  'recovery',
  'post_incident',
] as const; // NIST SP 800-61 lifecycle
export const CSF_CATEGORIES = ['DE.AE', 'RS.MA', 'RS.AN', 'RS.CO', 'RS.MI', 'RC.RP', 'RC.CO'] as const; // NIST CSF 2.0
export const SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
export const SCOPE_STATUSES = [
  'unknown',
  'suspected',
  'encrypted',
  'exfiltrated',
  'contained',
  'eradicated',
  'restored',
] as const;
export const DATA_TYPES = [
  'ssn',
  'drivers_license',
  'financial_account',
  'payment_card',
  'phi',
  'credentials',
  'biometric',
  'employee_hr',
  'privileged_legal',
  'trade_secret',
  'other_pii',
] as const;
export const ASSET_TYPES = ['endpoint', 'server', 'database', 'saas', 'backup', 'network', 'other'] as const;
export const TASK_STATUSES = ['open', 'in_progress', 'done', 'blocked'] as const;
export const DEADLINE_STATUSES = ['open', 'in_progress', 'done', 'not_applicable'] as const;

export const PhaseSchema = z.enum(PHASES);
export const CsfSchema = z.enum(CSF_CATEGORIES);
export const SeveritySchema = z.enum(SEVERITIES);
export const ScopeStatusSchema = z.enum(SCOPE_STATUSES);
export const DataTypeSchema = z.enum(DATA_TYPES);
export type Phase = z.infer<typeof PhaseSchema>;
export type Csf = z.infer<typeof CsfSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type ScopeStatus = z.infer<typeof ScopeStatusSchema>;
export type DataType = z.infer<typeof DataTypeSchema>;

// --- Field helpers ---------------------------------------------------------

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const Uuid = z.string().regex(UUID_V4);
const IdentityHex = z.string().regex(/^[0-9a-f]{64}$/);
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const IsoDate = z.iso.datetime({ offset: true });
const Count = z.number().int().min(0).max(10_000_000_000);
const text = (min: number, max: number) => z.string().min(min).max(max);

// --- Bodies ----------------------------------------------------------------

export const TitleBodySchema = z.strictObject({ title: text(1, 120) });

export const StatusBodySchema = z.strictObject({
  severity: SeveritySchema,
  phase: PhaseSchema,
  summary: text(0, 500),
});

export const TimelineBodySchema = z.strictObject({
  entryId: Uuid,
  occurredAt: IsoDate,
  phase: PhaseSchema,
  csf: CsfSchema,
  text: text(1, 4000),
  amends: Uuid.optional(),
});

export const AffectedStateSchema = z.strictObject({
  state: z.string().regex(/^[A-Z]{2}$/),
  count: Count,
});

export const ScopeBodySchema = z.strictObject({
  itemId: Uuid,
  system: text(1, 120),
  assetType: z.enum(ASSET_TYPES),
  status: ScopeStatusSchema,
  dataTypes: z.array(DataTypeSchema).max(DATA_TYPES.length),
  recordCount: Count.optional(),
  affected: z.array(AffectedStateSchema).max(60),
  euResidents: Count.optional(),
  notes: text(0, 2000),
});

export const TaskBodySchema = z.strictObject({
  taskId: Uuid,
  title: text(1, 200),
  assignee: IdentityHex.optional(),
  dueAt: IsoDate.optional(),
  status: z.enum(TASK_STATUSES),
});

export const ProfileBodySchema = z.strictObject({
  publicCompany: z.boolean(),
  hipaaCoveredEntity: z.boolean(),
  nydfsRegulated: z.boolean(),
  defenseContractor: z.boolean(),
  bank: z.boolean(),
  euDataSubjects: z.boolean(),
});

/** Shared by `legal.discovery` and `legal.materiality`. */
export const DiscoveryBodySchema = z.strictObject({
  determinedAt: IsoDate,
  basis: text(0, 1000),
});

export const DeadlineBodySchema = z.strictObject({
  ruleId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  status: z.enum(DEADLINE_STATUSES),
  owner: IdentityHex.optional(),
  note: text(0, 1000),
});

export const EvidenceBodySchema = z.strictObject({
  evidenceId: Uuid,
  label: text(1, 200),
  sha256: Sha256Hex,
  location: text(0, 300),
  custodian: text(0, 120),
});

export const RosterAdmitBodySchema = z.strictObject({
  memberIdentity: IdentityHex,
  role: z.enum(ROLES),
  displayName: text(1, 40),
});

export const RosterRevokeBodySchema = z.strictObject({
  memberIdentity: IdentityHex,
  reason: text(0, 500),
});

export const ChatBodySchema = z.strictObject({
  messageId: Uuid,
  text: text(1, 4000),
  mentions: z.array(IdentityHex).max(20),
  replyTo: Uuid.optional(),
});

export type TitleBody = z.infer<typeof TitleBodySchema>;
export type StatusBody = z.infer<typeof StatusBodySchema>;
export type TimelineBody = z.infer<typeof TimelineBodySchema>;
export type ScopeBody = z.infer<typeof ScopeBodySchema>;
export type TaskBody = z.infer<typeof TaskBodySchema>;
export type ProfileBody = z.infer<typeof ProfileBodySchema>;
export type DiscoveryBody = z.infer<typeof DiscoveryBodySchema>;
export type DeadlineBody = z.infer<typeof DeadlineBodySchema>;
export type EvidenceBody = z.infer<typeof EvidenceBodySchema>;
export type RosterAdmitBody = z.infer<typeof RosterAdmitBodySchema>;
export type RosterRevokeBody = z.infer<typeof RosterRevokeBodySchema>;
export type ChatBody = z.infer<typeof ChatBodySchema>;

// --- Kinds and per-kind policy ---------------------------------------------

export const PAYLOAD_KINDS = [
  'incident.title',
  'status.set',
  'timeline.add',
  'scope.set',
  'task.set',
  'profile.set',
  'legal.discovery',
  'legal.materiality',
  'deadline.update',
  'evidence.add',
  'roster.admit',
  'roster.revoke',
  'chat.post',
] as const;
export type PayloadKind = (typeof PAYLOAD_KINDS)[number];

interface KindPolicy {
  /** Channels the kind may appear in. */
  channels: readonly ChannelKind[];
  /** Author roles allowed to produce the kind (the channel write matrix also applies). */
  roles: readonly Role[];
}

const RECORD_ALL: KindPolicy = { channels: ['record'], roles: ['commander', 'counsel', 'technical'] };
const RECORD_LEGAL: KindPolicy = { channels: ['record'], roles: ['commander', 'counsel'] };
const RECORD_COMMANDER: KindPolicy = { channels: ['record'], roles: ['commander'] };

export const KIND_POLICY: Record<PayloadKind, KindPolicy> = {
  'incident.title': RECORD_COMMANDER,
  'status.set': RECORD_COMMANDER,
  'timeline.add': RECORD_ALL,
  'scope.set': RECORD_ALL,
  'task.set': RECORD_ALL,
  'profile.set': RECORD_LEGAL,
  'legal.discovery': RECORD_LEGAL,
  'legal.materiality': RECORD_LEGAL,
  'deadline.update': RECORD_LEGAL,
  'evidence.add': RECORD_ALL,
  'roster.admit': RECORD_COMMANDER,
  'roster.revoke': RECORD_COMMANDER,
  'chat.post': { channels: ['command', 'privileged', 'technical'], roles: ROLES },
};

export const isPayloadKind = (v: unknown): v is PayloadKind =>
  typeof v === 'string' && (PAYLOAD_KINDS as readonly string[]).includes(v);

/**
 * True when `role` may author `kind` in `channel`: the kind policy and the
 * channel write matrix must both allow it.
 */
export function isKindAllowed(kind: PayloadKind, channel: ChannelKind, role: Role): boolean {
  const p = KIND_POLICY[kind];
  return p.channels.includes(channel) && p.roles.includes(role) && canWrite(role, channel);
}

// --- Envelope --------------------------------------------------------------

const envelope = <K extends PayloadKind, B extends z.ZodType>(kind: K, body: B) =>
  z.strictObject({
    v: z.literal(PAYLOAD_VERSION),
    kind: z.literal(kind),
    sentAt: IsoDate,
    body,
  });

export const PayloadSchema = z.discriminatedUnion('kind', [
  envelope('incident.title', TitleBodySchema),
  envelope('status.set', StatusBodySchema),
  envelope('timeline.add', TimelineBodySchema),
  envelope('scope.set', ScopeBodySchema),
  envelope('task.set', TaskBodySchema),
  envelope('profile.set', ProfileBodySchema),
  envelope('legal.discovery', DiscoveryBodySchema),
  envelope('legal.materiality', DiscoveryBodySchema),
  envelope('deadline.update', DeadlineBodySchema),
  envelope('evidence.add', EvidenceBodySchema),
  envelope('roster.admit', RosterAdmitBodySchema),
  envelope('roster.revoke', RosterRevokeBodySchema),
  envelope('chat.post', ChatBodySchema),
]);

export type Payload = z.infer<typeof PayloadSchema>;
export type PayloadOf<K extends PayloadKind> = Extract<Payload, { kind: K }>;

export type ParseResult =
  | { ok: true; payload: Payload }
  | { ok: false; reason: 'unknown_kind' | 'invalid_payload' };

/**
 * Parses decrypted plaintext bytes into a payload. Never throws. Unknown kinds
 * are reported as such so the verifier can flag them instead of dropping them.
 */
export function parsePayloadBytes(bytes: Uint8Array): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (typeof json === 'object' && json !== null && 'kind' in json) {
    const k = (json as { kind: unknown }).kind;
    if (typeof k === 'string' && !isPayloadKind(k)) return { ok: false, reason: 'unknown_kind' };
  }
  const r = PayloadSchema.safeParse(json);
  return r.success ? { ok: true, payload: r.data } : { ok: false, reason: 'invalid_payload' };
}

/** Serializes a payload to the UTF-8 plaintext that gets sealed. Validates first. */
export function serializePayload(payload: Payload): Uint8Array {
  const parsed = PayloadSchema.parse(payload);
  return new TextEncoder().encode(JSON.stringify(parsed));
}

export { CHANNELS };
