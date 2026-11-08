// New-message tracking for the side chat and the sidebar badge.
//
// The "seen" mark is a server time: the newest message this member has had in
// front of them (side chat open, or the Secure Channels page). It is shared by
// the side chat button and the sidebar badge, kept per incident and member in
// this tab (sessionStorage, a number only, never content), and only moves
// forward. Comparing server time with server time keeps this laptop's clock
// out of it.

import { useSyncExternalStore } from "react";
import { cardPreviewText } from "@/components/incidents/blast-radius-model";
import { authorizedChatChannels, type ChatChannel } from "@/components/incidents/room-controls";
import type { ChannelMessage, IncidentState } from "@/lib/client/types";

/** How long a new message preview stays next to the chat button. */
export const PREVIEW_MS = 8_000;

export function serverTime(message: ChannelMessage): number {
  return message.serverTs instanceof Date ? message.serverTs.getTime() : Number.NaN;
}

/**
 * Server time of the newest message in the channels this member may read, or
 * null when there is none. Marks are kept in server time only, so this
 * laptop's clock never decides what counts as new.
 */
export function newestServerTime(state: IncidentState): number | null {
  let newest: number | null = null;
  for (const channel of authorizedChatChannels(state.me?.role, state.me?.state, state.channels)) {
    for (const message of channel.messages) {
      const at = serverTime(message);
      if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
    }
  }
  return newest;
}

/** The words a preview may show. Privileged text never leaves its channel view, the same rule as Overview. */
export function previewText(unread: UnreadMessage): string {
  return unread.channel === "privileged" ? "Privileged message" : cardPreviewText(unread.message.text);
}

/**
 * True while a message is fresh enough to preview. The window is bounded on
 * both sides, so a server time in the future (a bad clock, or a server lying,
 * since serverTs is not signed) cannot pin the popup on screen.
 */
export function inPreviewWindow(now: number | null, at: number): boolean {
  if (now === null || !Number.isFinite(now) || !Number.isFinite(at)) return false;
  return Math.abs(now - at) < PREVIEW_MS;
}

export interface UnreadMessage {
  channel: ChatChannel;
  message: ChannelMessage;
}

/**
 * Messages that arrived after `since`, from someone else, that passed every
 * check, in the channels this member may read. Oldest first.
 */
export function unreadMessages(state: IncidentState, since: number): UnreadMessage[] {
  const me = state.me?.identity;
  const list: UnreadMessage[] = [];
  for (const channel of authorizedChatChannels(state.me?.role, state.me?.state, state.channels)) {
    for (const message of channel.messages) {
      if (!message.verdict.ok || !message.author || message.author.identity === me) continue;
      const at = serverTime(message);
      if (Number.isFinite(at) && at > since) list.push({ channel: channel.kind, message });
    }
  }
  return list.sort((a, b) => serverTime(a.message) - serverTime(b.message));
}

const STORAGE_PREFIX = "zh.chat.seen.v1.";
const marks = new Map<string, number>();
const listeners = new Set<() => void>();

/** One mark per incident and member, so two demo tabs as different people do not share it. */
export function chatSeenKey(incidentId: string, identity: string | undefined): string | null {
  return identity ? `${incidentId}.${identity}` : null;
}

export function readChatSeen(key: string | null): number | undefined {
  if (key === null || typeof window === "undefined") return undefined;
  const held = marks.get(key);
  if (held !== undefined) return held;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    const value = raw === null ? Number.NaN : Number(raw);
    if (!Number.isNaN(value)) {
      marks.set(key, value);
      return value;
    }
  } catch {
    // Storage can be blocked; the mark then lives only in memory.
  }
  return undefined;
}

/** Moves the mark forward to `at`. It never moves back. */
export function markChatSeen(key: string | null, at: number | null): void {
  if (key === null || at === null || Number.isNaN(at)) return;
  const current = readChatSeen(key);
  if (current !== undefined && at <= current) return;
  marks.set(key, at);
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, String(at));
  } catch {
    // Memory still holds it for this tab.
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChatSeen(key: string | null): number | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readChatSeen(key),
    () => undefined,
  );
}

/** New messages since this member last had the chat open. Zero until the first mark exists. */
export function useChatUnreadCount(incidentId: string, state: IncidentState): number {
  const mark = useChatSeen(chatSeenKey(incidentId, state.me?.identity));
  return mark === undefined ? 0 : unreadMessages(state, mark).length;
}

/** Test helper. */
export function resetChatSeen(): void {
  marks.clear();
  for (const listener of [...listeners]) listener();
}
