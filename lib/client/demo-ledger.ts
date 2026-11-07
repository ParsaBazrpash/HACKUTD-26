// Browser copy of the demo record so a second tab can redeem an invite.
//
// This is not a security boundary. The live client never reads it. Values are
// plaintext on this device only. Untrusted input is zod-checked before use.

import { z } from "zod";
import { PayloadSchema, type Payload } from "@/lib/protocol/events";
import { isIdentityHex, isUuidV4 } from "@/spacetimedb/src/shared/limits";
import { CHANNELS, ROLES, type ChannelKind, type MemberStateName, type Role } from "@/spacetimedb/src/shared/policy";
import type { FailureReason, Verdict, WarningReason } from "@/lib/client/types";

const LEDGER_KEY = "zh.demo.ledger.v1";
const SESSION_KEY = "zh.demo.session.v1";
const MAX_LEDGER_CHARS = 1_500_000;

const Uuid = z.string().refine(isUuidV4);
const Identity = z.string().refine(isIdentityHex);
const Iso = z.iso.datetime({ offset: true });
const InviteRole = z.enum(["counsel", "technical", "executive"]);
const MemberState = z.enum(["pending", "active", "revoked"]);
const Failure = z.enum([
  "gap",
  "chain_broken",
  "unknown_author",
  "revoked_author",
  "bad_signature",
  "cannot_decrypt",
  "invalid_payload",
  "unknown_kind",
  "not_permitted",
  "replay",
  "stale_epoch",
  "history_rewritten",
]);
const Warning = z.enum(["clock_drift", "waiting_for_keys"]);

const InviteSchema = z.strictObject({
  token: Uuid,
  role: InviteRole,
  expiresAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  used: z.boolean(),
});

const MemberSchema = z.strictObject({
  memberId: z.string().regex(/^\d{1,20}$/),
  identity: Identity,
  displayName: z.string().min(1).max(40),
  role: z.enum(ROLES),
  state: MemberState,
  fingerprint: z.string().min(1).max(80),
  safetyCode: z.string().min(1).max(40),
  joinedAt: Iso,
  admittedAt: Iso.optional(),
  revokedAt: Iso.optional(),
  demoLinkMatched: z.boolean(),
});

const EventSchema = z.strictObject({
  channel: z.enum(CHANNELS),
  seq: z.string().regex(/^\d{1,20}$/),
  eventId: Uuid,
  author: z
    .strictObject({
      identity: Identity,
      displayName: z.string().min(1).max(40),
      role: z.enum(ROLES),
    })
    .nullable(),
  serverTs: Iso,
  sentAt: Iso.nullable(),
  payload: z.unknown(),
  verdict: z.strictObject({
    ok: z.boolean(),
    failures: z.array(Failure).max(8),
    warnings: z.array(Warning).max(8),
  }),
});

const WorldSchema = z.strictObject({
  id: Uuid,
  createdAt: Iso,
  nextMemberId: z.string().regex(/^\d{1,20}$/),
  members: z.array(MemberSchema).min(1).max(50),
  invites: z.array(InviteSchema).max(100),
  events: z.array(z.unknown()).max(400),
});

const FileSchema = z.strictObject({
  v: z.literal(1),
  nextIdentity: z.number().int().min(1).max(1_000_000),
  worlds: z.array(WorldSchema).max(8),
});

const SessionSchema = z.strictObject({
  v: z.literal(1),
  identity: Identity,
  currentId: Uuid,
});

export interface LedgerInvite {
  token: string;
  role: "counsel" | "technical" | "executive";
  expiresAt: number;
  used: boolean;
}

export interface LedgerMember {
  memberId: string;
  identity: string;
  displayName: string;
  role: Role;
  state: MemberStateName;
  fingerprint: string;
  safetyCode: string;
  joinedAt: string;
  admittedAt?: string;
  revokedAt?: string;
  demoLinkMatched: boolean;
}

export interface LedgerEvent {
  channel: ChannelKind;
  seq: string;
  eventId: string;
  author: { identity: string; displayName: string; role: Role } | null;
  serverTs: string;
  sentAt: string | null;
  payload: Payload | null;
  verdict: Verdict;
}

export interface LedgerWorld {
  id: string;
  createdAt: string;
  nextMemberId: string;
  members: LedgerMember[];
  invites: LedgerInvite[];
  events: LedgerEvent[];
}

export interface DemoLedgerFile {
  v: 1;
  nextIdentity: number;
  worlds: LedgerWorld[];
}

export interface DemoSession {
  v: 1;
  identity: string;
  currentId: string;
}

export interface DemoLedgerPort {
  read(): string | null;
  write(value: string): void;
  subscribe?(listener: () => void): () => void;
}

export interface DemoSessionPort {
  read(): string | null;
  write(value: string): void;
}

function verdictOf(value: z.infer<typeof EventSchema>["verdict"]): Verdict {
  return {
    ok: value.ok,
    failures: value.failures as FailureReason[],
    warnings: value.warnings as WarningReason[],
  };
}

function eventOf(value: unknown): LedgerEvent | null {
  const parsed = EventSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.payload === null) {
    return { ...parsed.data, payload: null, verdict: verdictOf(parsed.data.verdict) };
  }
  const payload = PayloadSchema.safeParse(parsed.data.payload);
  if (!payload.success) return null;
  return { ...parsed.data, payload: payload.data, verdict: verdictOf(parsed.data.verdict) };
}

export function parseDemoLedger(raw: string): DemoLedgerFile | null {
  if (raw.length === 0 || raw.length > MAX_LEDGER_CHARS) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = FileSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    v: 1,
    nextIdentity: parsed.data.nextIdentity,
    worlds: parsed.data.worlds.map((world) => ({
      ...world,
      events: world.events.flatMap((event) => {
        const accepted = eventOf(event);
        return accepted ? [accepted] : [];
      }),
    })),
  };
}

export function serializeDemoLedger(file: DemoLedgerFile): string {
  return JSON.stringify(file);
}

export function parseDemoSession(raw: string): DemoSession | null {
  if (raw.length === 0 || raw.length > 400) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = SessionSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function serializeDemoSession(session: DemoSession): string {
  return JSON.stringify(session);
}

function storageAvailable(storage: Storage): boolean {
  const probe = "zh.demo.probe";
  storage.setItem(probe, "1");
  storage.removeItem(probe);
  return true;
}

export function browserDemoLedger(): DemoLedgerPort | null {
  if (typeof window === "undefined") return null;
  try {
    if (!storageAvailable(window.localStorage)) return null;
    return {
      read: () => window.localStorage.getItem(LEDGER_KEY),
      write: (value) => window.localStorage.setItem(LEDGER_KEY, value),
      subscribe: (listener) => {
        const onStorage = (event: StorageEvent) => {
          if (event.key === LEDGER_KEY) listener();
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
      },
    };
  } catch {
    return null;
  }
}

export function browserDemoSession(): DemoSessionPort | null {
  if (typeof window === "undefined") return null;
  try {
    if (!storageAvailable(window.sessionStorage)) return null;
    return {
      read: () => window.sessionStorage.getItem(SESSION_KEY),
      write: (value) => window.sessionStorage.setItem(SESSION_KEY, value),
    };
  } catch {
    return null;
  }
}

export function createMemoryLedger(): DemoLedgerPort {
  let raw: string | null = null;
  const listeners = new Set<() => void>();
  let writing = false;
  return {
    read: () => raw,
    write: (value) => {
      raw = value;
      if (writing) return;
      writing = true;
      try {
        for (const listener of [...listeners]) listener();
      } finally {
        writing = false;
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createMemorySession(): DemoSessionPort {
  let raw: string | null = null;
  return {
    read: () => raw,
    write: (value) => {
      raw = value;
    },
  };
}
