import { z } from "zod";

/**
 * Types the current legal catalog still needs.
 * Moved out of the pre-contract `types/` model in B2a.
 * B3 replaces this catalog with `computeDeadlines(state, now)`.
 */

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/);
const timestampSchema = z.iso.datetime();
const envelopeIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);

const ciphertextEnvelopeSchema = z
  .strictObject({
    version: z.literal(1),
    algorithm: z.literal("AES-GCM"),
    provenance: z.enum(["fixture", "browser-sealed"]),
    keyId: envelopeIdSchema,
    nonce: envelopeIdSchema,
    ciphertext: z.string().min(1).max(200_000),
  })
  .refine(
    (envelope) => envelope.provenance !== "fixture" || envelope.ciphertext.startsWith("fixture:"),
    "Fixture envelopes must be labeled. They are not ciphertext.",
  );

export const legalClockStartSchema = z.enum([
  "awareness",
  "materiality_determination",
  "ransom_payment",
]);

export type LegalClockStart = z.infer<typeof legalClockStartSchema>;

export const legalDeadlineStatusSchema = z.enum(["upcoming", "due", "elapsed", "unscheduled"]);

export type LegalDeadlineStatus = z.infer<typeof legalDeadlineStatusSchema>;

/**
 * A planning clock. Citation and obligation are public statute text.
 * Case-specific counsel notes stay in `sealedCounselNote`, which is null
 * until a later legal engine stores them from IncidentState.
 */
export const legalDeadlineSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  catalogId: idSchema,
  citation: z.string().min(1).max(160),
  obligation: z.string().min(1).max(500),
  clockStarts: legalClockStartSchema,
  dueAt: timestampSchema.nullable(),
  status: legalDeadlineStatusSchema,
  scheduleNote: z.string().min(1).max(400).nullable(),
  sealedCounselNote: ciphertextEnvelopeSchema.nullable(),
});

export type LegalDeadline = z.infer<typeof legalDeadlineSchema>;
