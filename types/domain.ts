import { z } from "zod";
import {
  assetKindSchema,
  channelKindSchema,
  idSchema,
  incidentStatusSchema,
  integritySchema,
  roleSchema,
  taskStatusSchema,
  timestampSchema,
} from "@/types/common";

/**
 * Decrypted incident shapes. They exist only in browser memory after a future
 * Web Crypto open(). The data client does not accept them.
 * Rendering these before decryption exists would present plaintext the app cannot protect.
 */

export const incidentSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(4_000),
  status: incidentStatusSchema,
  startedAt: timestampSchema,
});

export type Incident = z.infer<typeof incidentSchema>;

export const memberSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  role: roleSchema,
  displayName: z.string().min(1).max(120),
  joinedAt: timestampSchema,
});

export type Member = z.infer<typeof memberSchema>;

export const channelSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  kind: channelKindSchema,
  topic: z.string().min(1).max(200),
  createdAt: timestampSchema,
});

export type Channel = z.infer<typeof channelSchema>;

export const incidentEventSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  channelId: idSchema,
  authorMemberId: idSchema,
  body: z.string().min(1).max(20_000),
  createdAt: timestampSchema,
  integrity: integritySchema,
});

export type IncidentEvent = z.infer<typeof incidentEventSchema>;

export const taskSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  description: z.string().min(1).max(2_000),
  status: taskStatusSchema,
  assigneeMemberId: idSchema.nullable(),
  dueAt: timestampSchema.nullable(),
});

export type Task = z.infer<typeof taskSchema>;

export const affectedAssetSchema = z.strictObject({
  id: idSchema,
  incidentId: idSchema,
  kind: assetKindSchema,
  descriptor: z.string().min(1).max(2_000),
  integrity: integritySchema,
});

export type AffectedAsset = z.infer<typeof affectedAssetSchema>;
