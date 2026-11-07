import { z } from "zod";
import {
  assetKindSchema,
  channelKindSchema,
  ciphertextEnvelopeSchema,
  idSchema,
  incidentStatusSchema,
  integritySchema,
  roleSchema,
  taskStatusSchema,
  timestampSchema,
} from "@/types/common";

/**
 * Records the data client may hold. No incident narrative fields.
 * Case facts belong in ciphertext envelopes, which this build does not produce.
 */

export const incidentShellSchema = z.strictObject({
  id: idSchema,
  status: incidentStatusSchema,
  startedAt: timestampSchema,
  sealedBrief: ciphertextEnvelopeSchema,
  integrity: integritySchema,
});

export type IncidentShell = z.infer<typeof incidentShellSchema>;

export const memberShellSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  role: roleSchema,
  joinedAt: timestampSchema,
  publicKeyId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).nullable(),
  integrity: integritySchema,
});

export type MemberShell = z.infer<typeof memberShellSchema>;

export const channelShellSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  kind: channelKindSchema,
  createdAt: timestampSchema,
  sealedTopic: ciphertextEnvelopeSchema,
});

export type ChannelShell = z.infer<typeof channelShellSchema>;

export const incidentEventShellSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  channelId: idSchema,
  authorMemberId: idSchema,
  createdAt: timestampSchema,
  sealedBody: ciphertextEnvelopeSchema,
  integrity: integritySchema,
});

export type IncidentEventShell = z.infer<typeof incidentEventShellSchema>;

export const taskShellSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  status: taskStatusSchema,
  assigneeMemberId: idSchema.nullable(),
  dueAt: timestampSchema.nullable(),
  sealedDetails: ciphertextEnvelopeSchema,
});

export type TaskShell = z.infer<typeof taskShellSchema>;

export const affectedAssetShellSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  kind: assetKindSchema,
  sealedDescriptor: ciphertextEnvelopeSchema,
  integrity: integritySchema,
});

export type AffectedAssetShell = z.infer<typeof affectedAssetShellSchema>;

export const joinIncidentInputSchema = z.strictObject({
  incidentId: idSchema,
  role: roleSchema,
  publicKeyId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).optional(),
});

export type JoinIncidentInput = z.infer<typeof joinIncidentInputSchema>;
