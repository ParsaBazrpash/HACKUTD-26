"use client";

import { useId, useState } from "react";
import { ExternalLink, MessageSquareShare, PenLine } from "lucide-react";
import { cardMessageText, channelHref, roundTripNote, type LiveCard } from "@/components/incidents/blast-radius-model";
import { CHANNEL_LABELS } from "@/components/incidents/labels";
import { authorizedChatChannels, canCompose, type ChatChannel } from "@/components/incidents/room-controls";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { syncCount, syncSampleSince } from "@/lib/client/sync-meter";

const shareButtonClass =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel-raised px-3 py-1.5 text-sm font-medium text-foreground hover:border-signal disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const selectClass =
  "min-h-9 rounded-lg border border-line bg-panel-raised px-2 py-1.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const inputClass =
  "min-h-9 w-full min-w-0 rounded-lg border border-line bg-panel-raised px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

/** Longest message typed next to Share. cardMessageText caps the caption at the same length. */
const MESSAGE_MAX = 300;

type Note = { tone: "ok"; text: string; channel: ChatChannel } | { tone: "error"; text: string };

/**
 * Posts a pointer to a live card into a chat channel, with an optional
 * message. The chat message holds the words and the pointer only; each reader
 * draws the card from their own verified record, so sharing never copies
 * record data into chat. Only channels this member may read and post in are
 * offered, from the same role table the module enforces.
 */
export function ShareToChat({ card, caption, label = "Share to chat" }: { card: LiveCard; caption: string; label?: string }) {
  const state = useIncident();
  const id = useId();
  const [picked, setPicked] = useState<ChatChannel | null>(null);
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const targets = authorizedChatChannels(state.me?.role, state.me?.state, state.channels).filter((channel) =>
    canCompose(state.me?.role, state.me?.state, channel.kind),
  );
  if (targets.length === 0) return null;
  const channel = targets.find((t) => t.kind === picked)?.kind ?? targets.find((t) => t.kind === "command")?.kind ?? targets[0].kind;
  const incidentId = state.incident?.id;

  async function share() {
    setBusy(true);
    setNote(null);
    const mark = syncCount();
    const words = message.trim().length > 0 ? message : caption;
    try {
      await getIncidentClient().postMessage(channel, { text: cardMessageText(card, words), mentions: [] });
      const timed = isMockIncidentClient() ? null : syncSampleSince(mark);
      setMessage("");
      setWriting(false);
      setNote({
        tone: "ok",
        channel,
        text: timed ? `Shared to ${CHANNEL_LABELS[channel]}. ${roundTripNote(timed.ms)}` : `Shared to ${CHANNEL_LABELS[channel]}.`,
      });
    } catch (cause) {
      setNote({ tone: "error", text: clientErrorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      {writing ? (
        <>
          <label htmlFor={`${id}-message`} className="sr-only">
            Message to send with the card
          </label>
          <input
            id={`${id}-message`}
            value={message}
            maxLength={MESSAGE_MAX}
            disabled={busy}
            autoFocus
            placeholder="Add a message, then press Enter or Share"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy) {
                event.preventDefault();
                void share();
              } else if (event.key === "Escape") {
                setWriting(false);
              }
            }}
            className={`${inputClass} max-w-md`}
          />
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void share()} className={shareButtonClass}>
          <MessageSquareShare aria-hidden="true" className="size-4 text-signal" />
          {label}
        </button>
        {targets.length > 1 ? (
          <>
            <span aria-hidden="true" className="text-sm text-muted">
              in
            </span>
            <select
              id={`${id}-channel`}
              aria-label="Channel to share to"
              value={channel}
              disabled={busy}
              onChange={(event) => setPicked(event.target.value as ChatChannel)}
              className={selectClass}
            >
              {targets.map((target) => (
                <option key={target.kind} value={target.kind}>
                  {CHANNEL_LABELS[target.kind]}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="text-sm text-muted">in {CHANNEL_LABELS[channel]}</span>
        )}
        {writing ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setWriting(true)}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <PenLine aria-hidden="true" className="size-3.5" />
            Add a message
          </button>
        )}
      </div>
      <p aria-live="polite" className={`min-h-4 text-xs ${note?.tone === "error" ? "text-alert" : "text-muted"}`}>
        {note?.text ?? ""}
        {note?.tone === "ok" && incidentId ? (
          <>
            {" "}
            <a
              href={channelHref(incidentId, note.channel)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-signal underline decoration-signal/40 underline-offset-2"
            >
              Open {CHANNEL_LABELS[note.channel]} in a new tab
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
