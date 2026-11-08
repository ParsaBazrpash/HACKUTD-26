// Browser copy of the demo org, so leaving it survives a reload.
//
// This is not a security boundary. The live client never reads it. The record
// holds the same stand-in names the fixture already shows. It never holds a
// phone number. Untrusted input is zod-checked before use.

import { z } from "zod";
import { isIdentityHex, isUuidV4 } from "@/spacetimedb/src/shared/limits";
import { ENROLL_LINK_CODE_LEN, MAX_ORG_NAME } from "@/spacetimedb/src/shared/org";

const ORG_KEY = "zh.demo.org.v1";
const MAX_ORG_CHARS = 200_000;

const Uuid = z.string().refine(isUuidV4);
const Identity = z.string().refine(isIdentityHex);
const Iso = z.iso.datetime({ offset: true });
const Id = z.string().regex(/^\d{1,20}$/);
const Role = z.enum(["counsel", "technical", "executive"]);

const MemberSchema = z.strictObject({
  orgMemberId: Id,
  identity: Identity,
  displayName: z.string().min(1).max(40),
  state: z.enum(["pending", "active", "revoked"]),
  fingerprint: z.string().min(1).max(80),
  safetyCode: z.string().min(1).max(40),
  enrolledAt: Iso,
  approvedAt: Iso.nullable(),
  keyChanged: z.boolean(),
  suggestedRole: Role,
  phoneBehavior: z.enum(["answers", "no_answer_first"]),
  attempts: z.number().int().nonnegative().max(1_000),
  revokedAt: Iso.nullable(),
  role: Role,
});

const OrgSchema = z.strictObject({
  orgId: Uuid,
  name: z.string().min(1).max(MAX_ORG_NAME),
  adminIdentity: Identity,
  adminFingerprint: z.string().min(1).max(80),
  nextMemberId: Id,
  nextSerial: z.number().int().nonnegative().max(1_000_000),
  links: z
    .array(
      z.strictObject({
        code: z.string().regex(new RegExp(`^[0-9a-f]{${ENROLL_LINK_CODE_LEN}}$`)),
        expiresAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
      }),
    )
    .max(20),
  members: z.array(MemberSchema).min(1).max(50),
});

const FileSchema = z.strictObject({
  v: z.literal(1),
  org: OrgSchema.nullable(),
});

export type StoredOrg = z.infer<typeof OrgSchema>;

export interface DemoOrgFile {
  v: 1;
  org: StoredOrg | null;
}

export interface DemoOrgStore {
  read(): string | null;
  write(value: string): void;
  subscribe?(listener: () => void): () => void;
}

export function parseDemoOrg(raw: string): DemoOrgFile | null {
  if (raw.length === 0 || raw.length > MAX_ORG_CHARS) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = FileSchema.safeParse(json);
  if (!parsed.success) return null;
  if (parsed.data.org && !parsed.data.org.members.some((member) => member.identity === parsed.data.org!.adminIdentity)) {
    return null;
  }
  return parsed.data;
}

export function serializeDemoOrg(file: DemoOrgFile): string {
  return JSON.stringify(file);
}

export function browserDemoOrgStore(): DemoOrgStore | null {
  if (typeof window === "undefined") return null;
  try {
    const probe = "zh.demo.probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return {
      read: () => window.localStorage.getItem(ORG_KEY),
      write: (value) => window.localStorage.setItem(ORG_KEY, value),
      subscribe: (listener) => {
        const onStorage = (event: StorageEvent) => {
          if (event.key === ORG_KEY) listener();
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
      },
    };
  } catch {
    return null;
  }
}

export function createMemoryOrgStore(): DemoOrgStore {
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
