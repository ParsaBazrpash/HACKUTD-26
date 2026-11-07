"use client";

import { useState, type FormEvent } from "react";
import { CHANNEL_LABELS } from "@/components/incidents/labels";
import { canCompose, draftChatBody, type ChatChannel } from "@/components/incidents/room-controls";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";

const fieldClass =
  "min-h-24 rounded-xl border border-line bg-panel-raised px-3 py-2 text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export function MessageComposer({ channel }: { channel: ChatChannel }) {
  const state = useIncident();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = canCompose(state.me?.role, state.me?.state, channel);
  if (!allowed) return null;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = draftChatBody(text);
    if (!draft.ok) {
      setError(draft.reason);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await getIncidentClient().postMessage(channel, draft.body);
      setText("");
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  const label = CHANNEL_LABELS[channel];
  return (
    <form onSubmit={send} className="mt-3 grid gap-2" aria-label={`Message ${label}`}>
      <label className="grid gap-2 text-sm" htmlFor={`message-${channel}`}>
        <span className="sr-only">Message {label}</span>
        <textarea
          id={`message-${channel}`}
          name={`message-${channel}`}
          value={text}
          maxLength={4000}
          rows={3}
          placeholder={`Write in ${label}`}
          onChange={(event) => setText(event.target.value)}
          className={fieldClass}
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={sending || text.trim().length === 0} className={`${primaryButtonClass} w-fit`}>
        {sending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
