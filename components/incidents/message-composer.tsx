"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { attachCardText, type LiveCard } from "@/components/incidents/blast-radius-model";
import { AttachedCardChip, CardAttachButton } from "@/components/incidents/card-attach";
import { CHANNEL_LABELS } from "@/components/incidents/labels";
import { canCompose, draftChatBody, type ChatChannel } from "@/components/incidents/room-controls";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";

const fieldClass =
  "min-h-24 rounded-xl border border-line bg-panel-raised px-3 py-2 text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export function MessageComposer({
  channel,
  compact = false,
  dock = false,
}: {
  channel: ChatChannel;
  compact?: boolean;
  dock?: boolean;
}) {
  const state = useIncident();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A live card attached from the paperclip. Only the dock composer offers it.
  const [attached, setAttached] = useState<LiveCard | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const allowed = canCompose(state.me?.role, state.me?.state, channel);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
  }, [text]);
  if (!allowed) return null;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const card = dock ? attached : null;
    const draft = draftChatBody(card ? attachCardText(text, card) : text);
    if (!draft.ok) {
      setError(draft.reason);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await getIncidentClient().postMessage(channel, draft.body);
      setText("");
      if (card) setAttached(null);
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setSending(false);
    }
  }

  const label = CHANNEL_LABELS[channel];

  function onDockKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  if (dock) {
    return (
      <form onSubmit={send} className="border-t border-line p-3" aria-label={`Message ${label}`}>
        {attached ? <AttachedCardChip card={attached} onRemove={() => setAttached(null)} /> : null}
        <div className="flex items-end gap-2">
          <CardAttachButton
            disabled={sending}
            onAttach={(card) => {
              setAttached(card);
              setError(null);
              field.current?.focus();
            }}
          />
          <label className="sr-only" htmlFor={`message-${channel}`}>
            Message {label}
          </label>
          <textarea
            ref={field}
            id={`message-${channel}`}
            name={`message-${channel}`}
            value={text}
            maxLength={4000}
            rows={1}
            placeholder={attached ? "Add a message (optional)..." : `Message ${label}...`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onDockKeyDown}
            className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          />
          <button
            type="submit"
            disabled={sending || (text.trim().length === 0 && !attached)}
            aria-label={sending ? "Sending" : "Send"}
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-signal text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <Send aria-hidden="true" className="size-4" />
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-alert">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  if (compact) {
    return (
      <form onSubmit={send} className="mt-4" aria-label={`Message ${label}`}>
        <label className="relative block text-sm" htmlFor={`message-${channel}`}>
          <span className="sr-only">Message {label}</span>
          <input
            id={`message-${channel}`}
            name={`message-${channel}`}
            value={text}
            maxLength={4000}
            placeholder={`Write in ${label}...`}
            onChange={(event) => setText(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-line bg-background py-2 pl-3 pr-12 text-sm text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          />
          <button
            type="submit"
            disabled={sending || text.trim().length === 0}
            aria-label={sending ? "Sending" : "Send"}
            className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-signal hover:text-signal-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <Send aria-hidden="true" className="size-4" />
          </button>
        </label>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-alert">
            {error}
          </p>
        ) : null}
      </form>
    );
  }
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
