"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Bell, Info, Lock, MessagesSquare, Users } from "lucide-react";
import { CHANNEL_BLURBS, CHANNEL_LABELS, ROLE_LABELS } from "@/components/incidents/labels";
import { MessageComposer } from "@/components/incidents/message-composer";
import { parseCardMessage } from "@/components/incidents/blast-radius-model";
import { LiveCardView } from "@/components/incidents/live-card";
import { authorizedChatChannels, canCompose, pickChatChannel, type ChatChannel } from "@/components/incidents/room-controls";
import { SafeText } from "@/components/incidents/safe-text";
import { selectMessages } from "@/components/incidents/situation";
import { VerdictNote } from "@/components/incidents/verdict-note";
import { useLocalClock } from "@/components/local-time";
import { useIncident } from "@/hooks/use-incident";
import type { ChannelMessage } from "@/lib/client/types";
import { formatLocalTimestamp } from "@/lib/time";
import { canRead, WRITE, type Role } from "@/spacetimedb/src/shared/policy";

type Drawer = "people" | "about" | "alerts";

const AUTHOR_TONE: Record<Role, string> = {
  commander: "text-signal",
  counsel: "text-verified",
  technical: "text-foreground",
  executive: "text-foreground",
};

function posterLine(kind: ChatChannel): string {
  const names = WRITE[kind].map((role) => ROLE_LABELS[role]);
  if (names.length <= 1) return `${names[0] ?? "No role"} can post.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} can post.`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]} can post.`;
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
}

function sentAtIso(value: Date): string | undefined {
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

function subscribeHash(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function currentHash(): string {
  return window.location.hash.slice(1);
}

function serverHash(): string {
  return "";
}

/**
 * The chat board. "page" is the Secure Channels page, where a /channels#name
 * link can pick the channel. "panel" is the side chat: one column, no link
 * lookup, and `initialChannel` (only ever looked up among readable channels)
 * picks where it opens.
 */
export function ChannelsBoard({
  limit,
  variant = "page",
  initialChannel = null,
}: {
  limit?: number;
  variant?: "page" | "panel";
  initialChannel?: ChatChannel | null;
}) {
  const panel = variant === "panel";
  const uid = useId();
  const state = useIncident();
  const channels = authorizedChatChannels(state.me?.role, state.me?.state, state.channels);
  const [picked, setPicked] = useState<ChatChannel | null>(null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const clockReady = useLocalClock();
  const scroller = useRef<HTMLDivElement>(null);
  // A link such as /channels#technical opens that channel, but only from the
  // channels this member may already read; anything else falls through.
  const linked = useSyncExternalStore(subscribeHash, currentHash, serverHash);

  const active = pickChatChannel(channels, picked, panel ? initialChannel : linked);

  const messages = active ? selectMessages(active.messages, limit) : [];

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [active?.kind, messages.length]);

  if (!active) {
    return <p className={`text-sm text-muted ${panel ? "p-4" : ""}`}>No chat channel is open for this role.</p>;
  }

  const label = CHANNEL_LABELS[active.kind];
  const canPost = canCompose(state.me?.role, state.me?.state, active.kind);
  const readers = state.members.filter((member) => member.state === "active" && canRead(member.role, active.kind));
  const hidden = limit !== undefined && active.messages.length > messages.length;
  const showPrivilegedNote = channels.some((channel) => channel.kind === "privileged") && active.kind !== "privileged";

  function openChannel(kind: ChatChannel) {
    setPicked(kind);
    setDrawer(null);
  }

  function toggleDrawer(next: Drawer) {
    setDrawer((current) => (current === next ? null : next));
  }

  return (
    <div
      className={
        panel
          ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
          : "flex h-[clamp(28rem,calc(100dvh-13rem),72rem)] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel lg:flex-row"
      }
    >
      <nav
        aria-label={panel ? "Chat channels" : "Channels"}
        className={
          panel
            ? "flex w-full min-w-0 shrink-0 flex-col border-b border-line bg-background/50"
            : "flex w-full min-w-0 shrink-0 flex-col border-b border-line bg-background/50 lg:w-64 lg:border-b-0 lg:border-r"
        }
      >
        {panel ? null : <p className="px-4 pb-1 pt-3 text-sm font-medium text-foreground">Channels</p>}
        <ul className={panel ? "flex gap-1 overflow-x-auto px-2 py-2" : "flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-y-auto lg:pb-3"}>
          {channels.map((channel) => {
            const current = channel.kind === active.kind;
            return (
              <li key={channel.kind} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => openChannel(channel.kind)}
                  className={
                    current
                      ? "flex w-auto items-center gap-2 rounded-md bg-signal/15 px-2.5 py-1.5 text-left text-sm font-medium text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal lg:w-full"
                      : "flex w-auto items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-muted hover:bg-panel-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal lg:w-full"
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{CHANNEL_LABELS[channel.kind]}</span>
                  {channel.kind === "privileged" ? <Lock aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {showPrivilegedNote && !panel ? (
          <p className="px-4 pb-3 text-xs leading-5 text-muted">{CHANNEL_BLURBS.privileged}</p>
        ) : null}
      </nav>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby={`${uid}-channel-${active.kind}`}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 id={`${uid}-channel-${active.kind}`} className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <span className="truncate">{label}</span>
              {active.kind === "privileged" ? <Lock aria-hidden="true" className="size-3.5 shrink-0 text-signal" /> : null}
            </h3>
            <p className="mt-0.5 text-sm leading-5 text-muted">{CHANNEL_BLURBS[active.kind]}</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-expanded={drawer === "people"}
              aria-controls={`${uid}-channel-people`}
              onClick={() => toggleDrawer("people")}
              className={iconButtonClass(drawer === "people")}
            >
              <Users aria-hidden="true" className="size-4" />
              <span>{readers.length}</span>
              <span className="sr-only"> people who can read this channel</span>
            </button>
            <button
              type="button"
              aria-expanded={drawer === "alerts"}
              aria-controls={`${uid}-channel-alerts`}
              aria-label="Channel alerts"
              onClick={() => toggleDrawer("alerts")}
              className={iconButtonClass(drawer === "alerts")}
            >
              <Bell aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              aria-expanded={drawer === "about"}
              aria-controls={`${uid}-channel-about`}
              aria-label="About this channel"
              onClick={() => toggleDrawer("about")}
              className={iconButtonClass(drawer === "about")}
            >
              <Info aria-hidden="true" className="size-4" />
            </button>
          </div>
        </header>

        {drawer === "people" ? (
          <div id={`${uid}-channel-people`} className="max-h-40 overflow-y-auto border-b border-line px-4 py-3">
            {readers.length === 0 ? (
              <p className="text-sm text-muted">No active member can read this channel.</p>
            ) : (
              <ul className="space-y-1.5">
                {readers.map((member) => (
                  <li key={member.identity} className="break-words text-sm text-foreground">
                    {member.displayName}
                    <span className="text-muted"> · {ROLE_LABELS[member.role]}</span>
                    {member.online ? <span className="text-muted"> · Online</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {drawer === "alerts" ? (
          <p id={`${uid}-channel-alerts`} className="border-b border-line px-4 py-3 text-sm leading-6 text-muted">
            New messages appear in this channel while the incident is open in this tab. HAVEN does not send a separate alert for {label}.
          </p>
        ) : null}
        {drawer === "about" ? (
          <div id={`${uid}-channel-about`} className="space-y-1 border-b border-line px-4 py-3 text-sm leading-6 text-muted">
            <p>{posterLine(active.kind)}</p>
            <p>Plaintext and channel keys stay in this browser.</p>
          </div>
        ) : null}

        {active.waitingForKeys ? <p className="border-b border-line px-4 py-2 text-sm text-muted">Waiting for channel keys.</p> : null}
        {hidden ? (
          <p className="border-b border-line px-4 py-2 text-xs text-muted">
            Showing the latest messages. Older checked messages stay in the list when a check failed.
          </p>
        ) : null}

        <div
          ref={scroller}
          className={
            messages.length === 0
              ? "flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center"
              : "min-h-0 flex-1 overflow-y-auto py-3"
          }
        >
          {messages.length === 0 ? (
            <div>
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-signal/10 text-signal">
                <MessagesSquare aria-hidden="true" className="size-7" />
              </span>
              <p className="mt-4 text-base font-semibold text-foreground">No messages yet</p>
              <p className="mt-1 text-sm text-muted">
                {canPost ? `Start the conversation in ${label}.` : "You can read this channel. Your role cannot post here."}
              </p>
            </div>
          ) : (
            <ul aria-label={`Messages in ${label}`}>
              {messages.map((message) => (
                <MessageRow
                  key={`${message.seq.toString()}-${message.messageId}`}
                  message={message}
                  clockReady={clockReady}
                />
              ))}
            </ul>
          )}
        </div>

        {canPost ? (
          <MessageComposer key={active.kind} channel={active.kind} dock />
        ) : (
          <p className="border-t border-line px-4 py-3 text-sm text-muted">You can read this channel. Your role cannot post here.</p>
        )}
      </section>
    </div>
  );
}

function MessageRow({ message, clockReady }: { message: ChannelMessage; clockReady: boolean }) {
  const name = message.author?.displayName ?? "Unknown author";
  const tone = message.author ? AUTHOR_TONE[message.author.role] : "text-foreground";
  // Only a message that passed every check may draw a live card; anything else stays plain text.
  const shared = message.verdict.ok ? parseCardMessage(message.text) : null;
  return (
    <li className="flex min-w-0 gap-3 px-4 py-2">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-background text-xs font-medium text-signal"
      >
        {initial(name)}
      </span>
      <div className="min-w-0">
        <p className="break-words text-sm">
          <span className={`font-medium ${tone}`}>{name}</span>
          {message.author ? <span className="text-muted"> · {ROLE_LABELS[message.author.role]}</span> : null}
          {clockReady ? (
            <time className="ml-2 text-xs text-muted" dateTime={sentAtIso(message.sentAt)}>
              {formatLocalTimestamp(message.sentAt)}
            </time>
          ) : null}
          {message.verdict.ok ? null : (
            <span className="text-xs text-alert"> · seq {message.seq.toString()}</span>
          )}
        </p>
        {shared ? (
          <>
            {shared.caption ? (
              <p className="mt-0.5 break-words text-sm leading-6 text-foreground">
                <SafeText text={shared.caption} />
              </p>
            ) : null}
            <LiveCardView card={shared.card} sharedAt={message.serverTs} />
          </>
        ) : (
          <p className="mt-0.5 break-words text-sm leading-6 text-foreground">
            <SafeText text={message.text} />
          </p>
        )}
        <VerdictNote verdict={message.verdict} />
      </div>
    </li>
  );
}

function iconButtonClass(active: boolean): string {
  return active
    ? "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    : "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
}
