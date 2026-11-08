"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type Ref } from "react";
import { Maximize2, MessagesSquare, X } from "lucide-react";
import { cardPreviewText } from "@/components/incidents/blast-radius-model";
import { ChannelsBoard } from "@/components/incidents/channels-board";
import { CHANNEL_LABELS } from "@/components/incidents/labels";
import { authorizedChatChannels, type ChatChannel } from "@/components/incidents/room-controls";
import { SafeText } from "@/components/incidents/safe-text";
import { incidentSectionHref } from "@/components/incidents/sections";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import type { ChannelMessage, IncidentState } from "@/lib/client/types";

/** When this tab loaded. Messages older than this were already on the record when the member arrived. */
const TAB_OPENED_AT = typeof window === "undefined" ? Number.POSITIVE_INFINITY : performance.timeOrigin;
/** How long a new message preview stays next to the chat button. */
const PREVIEW_MS = 8_000;

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
      const at = message.serverTs instanceof Date ? message.serverTs.getTime() : Number.NaN;
      if (Number.isFinite(at) && at > since) list.push({ channel: channel.kind, message });
    }
  }
  return list.sort((a, b) => a.message.serverTs.getTime() - b.message.serverTs.getTime());
}

/**
 * Side chat for every incident page: a button at the bottom right opens the
 * chat board in a panel, so people can talk while they work the map, tasks or
 * legal clocks. It reads the same live state as the rest of the page (no
 * second connection or unlock) and offers only the channels this member may
 * read. Hidden on the Secure Channels page itself.
 */
export function ChatPanel({ incidentId }: { incidentId: string }) {
  const state = useIncident();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [startOn, setStartOn] = useState<ChatChannel | null>(null);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const onChannelsPage = pathname === incidentSectionHref(incidentId, "channels");
  const ready = state.incident?.id === incidentId && state.me?.state === "active";
  const channels = ready ? authorizedChatChannels(state.me?.role, state.me?.state, state.channels) : [];
  const shown = ready && channels.length > 0 && !onChannelsPage;
  const visible = shown && open;

  useEffect(() => {
    if (visible) {
      wasOpen.current = true;
      const node = panel.current;
      const field = node?.querySelector<HTMLTextAreaElement>("textarea");
      (field ?? node)?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      launcher.current?.focus();
    }
  }, [visible]);

  if (!shown) return null;

  function openPanel(channel: ChatChannel | null) {
    setStartOn(channel);
    setSeenAt(Date.now());
    setOpen(true);
  }

  function closePanel() {
    setSeenAt(Date.now());
    setOpen(false);
  }

  return (
    <div className="no-print">
      {visible ? (
        <div
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="chat-panel-title"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closePanel();
            }
          }}
          className="haven-slide-in fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-panel shadow-2xl shadow-black/50 outline-none sm:w-[28rem]"
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <h2 id="chat-panel-title" className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <MessagesSquare aria-hidden="true" className="size-4 text-signal" />
                Chat
                <span className="relative inline-flex size-2" aria-hidden="true">
                  <span className="absolute inline-flex size-full rounded-full bg-signal opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2 rounded-full bg-signal" />
                </span>
              </h2>
              <p className="mt-0.5 text-xs text-muted">Encrypted in this browser. Keep working, the page stays live.</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href={incidentSectionHref(incidentId, "channels")}
                aria-label="Open Secure Channels as a full page"
                className="grid size-9 place-items-center rounded-md text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <Maximize2 aria-hidden="true" className="size-4" />
              </Link>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close chat"
                className="grid size-9 place-items-center rounded-md text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1">
            <ChannelsBoard variant="panel" initialChannel={startOn} />
          </div>
        </div>
      ) : (
        <ChatLauncher ref={launcher} state={state} since={seenAt ?? TAB_OPENED_AT} onOpen={openPanel} />
      )}
    </div>
  );
}

/** The chat button, its new-message count, and a short preview of the newest message. */
function ChatLauncher({
  ref,
  state,
  since,
  onOpen,
}: {
  ref: Ref<HTMLButtonElement>;
  state: IncidentState;
  since: number;
  onOpen: (channel: ChatChannel | null) => void;
}) {
  // Ticks once a second, so the preview hides itself without a timer of our own.
  const now = useBrowserNow();
  const unread = unreadMessages(state, since);
  const newest = unread.at(-1);
  const preview = newest && now !== null && now - newest.message.serverTs.getTime() < PREVIEW_MS ? newest : null;
  const count = unread.length;

  return (
    <div className="fixed bottom-5 right-5 z-40 flex max-w-[calc(100vw-2.5rem)] flex-col items-end gap-2">
      {preview ? (
        <button
          type="button"
          onClick={() => onOpen(preview.channel)}
          className="haven-pop w-80 max-w-full rounded-xl border border-line bg-panel p-3 text-left shadow-xl shadow-black/40 hover:border-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <span className="block text-xs text-muted">
            <span className="font-medium text-foreground">{preview.message.author?.displayName ?? "Someone"}</span> in{" "}
            {CHANNEL_LABELS[preview.channel]}
          </span>
          <span className="mt-1 line-clamp-2 block break-words text-sm text-foreground">
            <SafeText text={cardPreviewText(preview.message.text)} />
          </span>
        </button>
      ) : null}
      <button
        ref={ref}
        type="button"
        onClick={() => onOpen(null)}
        aria-label={count > 0 ? `Open chat, ${count} new message${count === 1 ? "" : "s"}` : "Open chat"}
        className="inline-flex min-h-12 items-center gap-2 rounded-full bg-signal px-5 text-sm font-semibold text-signal-ink shadow-lg shadow-black/40 hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <MessagesSquare aria-hidden="true" className="size-5" />
        Chat
        {count > 0 ? (
          <span
            key={count}
            aria-hidden="true"
            className="haven-pop grid min-w-6 place-items-center rounded-full bg-background px-1.5 text-xs font-semibold text-signal"
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
      <p aria-live="polite" className="sr-only">
        {preview ? `New message from ${preview.message.author?.displayName ?? "someone"} in ${CHANNEL_LABELS[preview.channel]}.` : ""}
      </p>
    </div>
  );
}
