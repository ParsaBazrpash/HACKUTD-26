import { z } from "zod";
import { ciphertextEnvelopeSchema, idSchema, timestampSchema } from "@/types/common";

export const legalClockStartSchema = z.enum([
  "awareness",
  "materiality_determination",
  "ransom_payment",
]);

export type LegalClockStart = z.infer<typeof legalClockStartSchema>;

export const legalDeadlineStatusSchema = z.enum([
  "upcoming",
  "due",
  "elapsed",
  "unscheduled",
]);

export type LegalDeadlineStatus = z.infer<typeof legalDeadlineStatusSchema>;

/**
 * A planning clock. Citation and obligation are public statute text.
 * Case-specific counsel notes stay in `sealedCounselNote`, which is null
 * until browser sealing exists.
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
