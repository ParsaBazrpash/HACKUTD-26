// Pure decisions for the Gate 2 controls. The screens call IncidentClient;
// they do not invent roles, channels, or payload fields.

import { ChatBodySchema, type ChatBody } from "@/lib/protocol/events";
import {
  INVITE_TTL_DEFAULT_MIN,
  INVITE_TTL_MAX_MIN,
} from "@/spacetimedb/src/shared/limits";
import {
  canRead,
  canWrite,
  type ChannelKind,
  type MemberStateName,
  type Role,
} from "@/spacetimedb/src/shared/policy";
import type { ChannelView } from "@/lib/client/types";

export const DEFAULT_INVITE_TTL_MINUTES = INVITE_TTL_DEFAULT_MIN;

/** Lifetimes the invite form offers. Every value is inside the module limit. */
export const INVITE_TTL_CHOICES = [INVITE_TTL_DEFAULT_MIN, 30, INVITE_TTL_MAX_MIN].filter(
  (value, index, all) => all.indexOf(value) === index && value >= 1 && value <= INVITE_TTL_MAX_MIN,
);

export type InviteRole = "counsel" | "technical" | "executive";
export type ChatChannel = "command" | "privileged" | "technical";

const CHAT_DRAFT_ID = "00000000-0000-4000-8000-000000000001";

export function isInviteRole(value: string): value is InviteRole {
  return value === "counsel" || value === "technical" || value === "executive";
}

export function isInviteTtl(value: number): boolean {
  return INVITE_TTL_CHOICES.includes(value);
}

export function inviteRequest(
  role: string,
  ttlMinutes: number = DEFAULT_INVITE_TTL_MINUTES,
): { role: InviteRole; ttlMinutes: number } {
  if (!isInviteRole(role)) throw new Error("That role cannot be invited.");
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > INVITE_TTL_MAX_MIN) {
    throw new Error("Invite lifetime must be between 1 and 60 minutes.");
  }
  return { role, ttlMinutes };
}

export function isChatChannel(kind: ChannelKind): kind is ChatChannel {
  return kind === "command" || kind === "privileged" || kind === "technical";
}

/** Chat channels this member may see. #record and unreadable channels are omitted. */
export function authorizedChatChannels(
  role: Role | undefined,
  memberState: MemberStateName | undefined,
  channels: readonly ChannelView[],
): Array<ChannelView & { kind: ChatChannel }> {
  if (!role || memberState !== "active") return [];
  return channels.filter((channel): channel is ChannelView & { kind: ChatChannel } =>
    isChatChannel(channel.kind) && canRead(role, channel.kind),
  );
}

/** True when this member may post chat into the channel. #record is never included. */
export function canCompose(
  role: Role | undefined,
  memberState: MemberStateName | undefined,
  channel: ChannelKind,
): boolean {
  if (!role || memberState !== "active" || !isChatChannel(channel)) return false;
  return canRead(role, channel) && canWrite(role, channel);
}

export type ChatDraft =
  | { ok: true; body: Omit<ChatBody, "messageId"> }
  | { ok: false; reason: string };

/** Builds the chat body the client accepts. The client assigns messageId. */
export function draftChatBody(raw: string): ChatDraft {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: "Enter a message." };
  if (text.length > 4000) return { ok: false, reason: "Messages are limited to 4000 characters." };
  const parsed = ChatBodySchema.safeParse({
    messageId: CHAT_DRAFT_ID,
    text,
    mentions: [],
  });
  if (!parsed.success) return { ok: false, reason: "That message cannot be sent." };
  return { ok: true, body: { text: parsed.data.text, mentions: parsed.data.mentions } };
}

export function admitEnabled(
  me: { role: Role; state: MemberStateName } | null,
  member: { state: MemberStateName; linkVerified?: boolean },
): boolean {
  if (!me || me.role !== "commander" || me.state !== "active") return false;
  if (member.state !== "pending") return false;
  return member.linkVerified === true;
}

export function linkVerifiedLabel(linkVerified: boolean | undefined): string {
  if (linkVerified === true) return "Link verified";
  if (linkVerified === false) return "Unverified: do not admit";
  return "Link check has not finished";
}
