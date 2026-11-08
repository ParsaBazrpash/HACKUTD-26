"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type Ref } from "react";
import { Maximize2, MessagesSquare, X } from "lucide-react";
import { ChannelsBoard } from "@/components/incidents/channels-board";
import { CHANNEL_LABELS } from "@/components/incidents/labels";
import {
  chatSeenKey,
  inPreviewWindow,
  markChatSeen,
  newestServerTime,
  previewText,
  readChatSeen,
  serverTime,
  unreadMessages,
  useChatSeen,
} from "@/components/incidents/chat-unread";
import { authorizedChatChannels, type ChatChannel } from "@/components/incidents/room-controls";
import { incidentSectionHref } from "@/components/incidents/sections";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import type { IncidentState } from "@/lib/client/types";

/**
 * Side chat for every incident page: a button at the bottom right opens the
 * chat board in a panel, so people can talk while they work the map, tasks or
 * legal clocks. It reads the same live state as the rest of the page (no
 * second connection or unlock) and offers only the channels this member may
 * read. Hidden on the Secure Channels page itself.
 */
export function ChatPanel({ incidentId }: { incidentId: string }) {
  const state = useIncident();
  // Mounts once this member is active in this incident, so what was already on
  // the record at that moment counts as seen.
  if (state.incident?.id !== incidentId || state.me?.state !== "active") return null;
  return <ReadyChatPanel incidentId={incidentId} state={state} />;
}

function ReadyChatPanel({ incidentId, state }: { incidentId: string; state: IncidentState }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [startOn, setStartOn] = useState<ChatChannel | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  // Shared with the sidebar badge: server time of the newest message this member has had in front of them.
  const seenKey = chatSeenKey(incidentId, state.me?.identity);
  const mark = useChatSeen(seenKey);
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const onChannelsPage = pathname === incidentSectionHref(incidentId, "channels");
  if (pathname !== lastPath) {
    // The Secure Channels page is the chat itself; arriving there closes the side chat for good.
    setLastPath(pathname);
    if (onChannelsPage) setOpen(false);
  }
  const channels = authorizedChatChannels(state.me?.role, state.me?.state, state.channels);
  const shown = channels.length > 0 && !onChannelsPage;
  const visible = shown && open;

  // First time in this incident in this tab: what is already on the record counts as seen.
  useEffect(() => {
    if (readChatSeen(seenKey) === undefined) markChatSeen(seenKey, newestServerTime(state) ?? Number.NEGATIVE_INFINITY);
  }, [seenKey, state]);

  // While the chat is in front of them (side panel open, or the Secure Channels page), everything is read.
  useEffect(() => {
    if (visible || onChannelsPage) markChatSeen(seenKey, newestServerTime(state));
  }, [seenKey, visible, onChannelsPage, state]);

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
    markChatSeen(seenKey, newestServerTime(state));
    setOpen(true);
  }

  function closePanel() {
    markChatSeen(seenKey, newestServerTime(state));
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
        <ChatLauncher ref={launcher} state={state} since={mark ?? Number.POSITIVE_INFINITY} onOpen={openPanel} />
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
  const preview = newest && inPreviewWindow(now, serverTime(newest.message)) ? newest : null;
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
          {/* Plain text: a link here would sit inside the button and leave the app. */}
          <span className="mt-1 line-clamp-2 block break-words text-sm text-foreground">{previewText(preview)}</span>
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
