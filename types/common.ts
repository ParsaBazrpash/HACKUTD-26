import { z } from "zod";

/**
 * Shared primitives. Schemas are the source of truth.
 * `keyId` is a lookup id, never key bytes.
 */

export const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/);

export const timestampSchema = z.iso.datetime();

export const roleSchema = z.enum([
  "incident_commander",
  "legal_counsel",
  "forensic_investigator",
  "executive",
  "responder",
]);

export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  incident_commander: "Incident commander",
  legal_counsel: "Legal counsel",
  forensic_investigator: "Forensic investigator",
  executive: "Executive",
  responder: "Responder",
};

export const incidentStatusSchema = z.enum(["active", "contained", "closed"]);

export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  active: "Active",
  contained: "Contained",
  closed: "Closed",
};

export const channelKindSchema = z.enum([
  "command",
  "legal",
  "forensics",
  "executive",
]);

export type ChannelKind = z.infer<typeof channelKindSchema>;

export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  command: "Command",
  legal: "Legal",
  forensics: "Forensics",
  executive: "Executive",
};

export const taskStatusSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "done",
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export const assetKindSchema = z.enum([
  "endpoint",
  "server",
  "identity",
  "saas",
  "data_store",
]);

export type AssetKind = z.infer<typeof assetKindSchema>;

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  endpoint: "Endpoint",
  server: "Server",
  identity: "Identity",
  saas: "SaaS",
  data_store: "Data store",
};

export const integrityStatusSchema = z.enum([
  "unknown",
  "unverified",
  "verified",
  "failed",
]);

export type IntegrityStatus = z.infer<typeof integrityStatusSchema>;

export const integritySchema = z
  .strictObject({
    status: integrityStatusSchema,
    source: z.enum(["unset", "browser-verified"]),
  })
  .refine(
    (value) => value.status === "unknown" || value.source === "browser-verified",
    "Only browser verification may set an integrity status.",
  );

export type Integrity = z.infer<typeof integritySchema>;

export const UNSET_INTEGRITY: Integrity = {
  status: "unknown",
  source: "unset",
};

const envelopeIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);

export const ciphertextEnvelopeSchema = z
  .strictObject({
    version: z.literal(1),
    algorithm: z.literal("AES-GCM"),
    provenance: z.enum(["fixture", "browser-sealed"]),
    keyId: envelopeIdSchema,
    nonce: envelopeIdSchema,
    ciphertext: z.string().min(1).max(200_000),
  })
  .refine(
    (envelope) =>
      envelope.provenance !== "fixture" || envelope.ciphertext.startsWith("fixture:"),
    "Fixture envelopes must be labeled. They are not ciphertext.",
  );

export type CiphertextEnvelope = z.infer<typeof ciphertextEnvelopeSchema>;
