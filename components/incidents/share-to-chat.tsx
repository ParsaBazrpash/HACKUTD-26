"use client";

import { useId, useState } from "react";
import { MessageSquareShare } from "lucide-react";
import { cardMessageText, type LiveCard } from "@/components/incidents/blast-radius-model";
import { CHANNEL_LABELS } from "@/components/incidents/labels";
import { authorizedChatChannels, canCompose, type ChatChannel } from "@/components/incidents/room-controls";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { syncSamples } from "@/lib/client/sync-meter";

const shareButtonClass =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel-raised px-3 py-1.5 text-sm font-medium text-foreground hover:border-signal disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const selectClass =
  "min-h-9 rounded-lg border border-line bg-panel-raised px-2 py-1.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

/**
 * Posts a pointer to a live card into a chat channel. The message holds a
 * caption and the pointer only; each reader draws the card from their own
 * verified record, so sharing never copies record data into chat.
 */
export function ShareToChat({ card, caption, label = "Share to chat" }: { card: LiveCard; caption: string; label?: string }) {
  const state = useIncident();
  const id = useId();
  const [picked, setPicked] = useState<ChatChannel | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const targets = authorizedChatChannels(state.me?.role, state.me?.state, state.channels).filter((channel) =>
    canCompose(state.me?.role, state.me?.state, channel.kind),
  );
  if (targets.length === 0) return null;
  const channel = targets.find((t) => t.kind === picked)?.kind ?? targets.find((t) => t.kind === "command")?.kind ?? targets[0].kind;

  async function share() {
    setBusy(true);
    setNote(null);
    const before = syncSamples().length;
    try {
      await getIncidentClient().postMessage(channel, { text: cardMessageText(card, caption), mentions: [] });
      const samples = syncSamples();
      const timed = !isMockIncidentClient() && samples.length > before ? samples[samples.length - 1] : null;
      setNote({
        tone: "ok",
        text: timed
          ? `Shared to ${CHANNEL_LABELS[channel]}. Live for everyone in ${timed.ms} ms.`
          : `Shared to ${CHANNEL_LABELS[channel]}.`,
      });
    } catch (cause) {
      setNote({ tone: "error", text: clientErrorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1.5">
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
      </div>
      <p aria-live="polite" className={`min-h-4 text-xs ${note?.tone === "error" ? "text-alert" : "text-muted"}`}>
        {note?.text ?? ""}
      </p>
    </div>
  );
}
