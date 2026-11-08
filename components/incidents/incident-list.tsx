"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DemoBanner } from "@/components/incidents/demo-banner";
import { PasskeyLockCard } from "@/components/security/passkey-lock-card";
import { CHANNEL_LABELS, connectionLabel, phaseLabel } from "@/components/incidents/labels";
import { IntegrityMark } from "@/components/ui/integrity-mark";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { formatLocalTimestamp } from "@/lib/time";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";

const fieldClass =
  "rounded-xl border border-line bg-panel px-3 py-2 text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export function IncidentList() {
  const state = useIncident();
  const now = useBrowserNow();
  const mock = isMockIncidentClient();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const created = await getIncidentClient().createIncident({ title, displayName });
      router.push(`/incidents/${created.incidentId}`);
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  const incident = state.incident;
  // While a room is held here, creating another stays one click away instead of filling the page.
  const holding = incident !== null && state.me?.state !== "revoked";
  const channelNames = [
    ...(state.me?.state === "active" ? ["Record log"] : []),
    ...state.channels.map((channel) => CHANNEL_LABELS[channel.kind]),
  ];

  return (
    <div className="grid gap-8">
      <DemoBanner />
      <PasskeyLockCard />
      <div className="grid gap-2 text-sm">
        <span className="font-mono text-[11px] tracking-[0.16em] text-muted">
          {connectionLabel(state.connection, mock).toUpperCase()}
        </span>
        {incident ? <IntegrityMark report={state.integrity} mock={mock} /> : null}
      </div>
      {state.connection === "connecting" ? (
        <p className="text-sm text-muted">Opening the incident client…</p>
      ) : null}
      {state.connection === "offline" ? (
        <p className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">
          The connection dropped. Showing the last update held in this tab.
        </p>
      ) : null}
      {state.connection === "error" ? (
        <p role="alert" className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-alert">
          {state.error ?? "The incident client hit an error."}
        </p>
      ) : null}
      {state.me?.state === "revoked" ? (
        <p className="text-sm text-foreground">Your access to this incident was revoked.</p>
      ) : null}

      {incident && state.me?.state !== "revoked" ? (
        <ul>
          <li>
            <Link
              href={`/incidents/${incident.id}`}
              className="grid gap-3 rounded-2xl border border-line bg-panel px-4 py-4 transition-colors hover:border-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:items-center"
            >
              <span
                className={`font-mono text-xs tracking-[0.14em] uppercase ${
                  state.status?.severity === "SEV1" ? "text-alert" : "text-signal"
                }`}
              >
                {state.status ? state.status.severity : "Open"}
              </span>
              <span className="min-w-0">
                <span className="block break-words text-sm text-foreground">
                  {incident.title || "Untitled incident"}
                </span>
                <span className="mt-1 block break-words text-sm text-muted">
                  {state.status ? phaseLabel(state.status.phase) : "No status yet"}
                  {now === null ? "" : ` · ${formatLocalTimestamp(incident.createdAt)}`}
                  {channelNames.length > 0 ? ` · ${channelNames.join(" · ")}` : ""}
                </span>
              </span>
              <span className="font-mono text-xs text-muted">
                {state.members.length} members
                <span className="mt-1 block text-signal">Open</span>
              </span>
            </Link>
          </li>
        </ul>
      ) : state.connection !== "connecting" && state.me?.state !== "revoked" ? (
        <div className="grid gap-1 text-sm text-muted">
          <p>No incident is open in this tab.</p>
          {mock ? null : (
            <p className="max-w-2xl leading-6">
              Rooms live in the browser and web address you joined from. If you joined somewhere else, open it there.
              If you lost that browser or cleared its data, ask the commander to use Replace device and send you a new
              invite.
            </p>
          )}
        </div>
      ) : null}

      {holding && !showCreate ? (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex min-h-11 w-fit items-center justify-center rounded-lg border border-line bg-panel-raised px-4 py-2 text-sm font-medium text-foreground hover:border-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          New incident
        </button>
      ) : (
        <form onSubmit={create} className="grid max-w-xl gap-5 rounded-2xl border border-line bg-panel px-5 py-5">
          <h2 className="text-xl font-medium tracking-tight">Create incident</h2>
          <p className="text-sm leading-6 text-muted">
            You become the commander. Everyone else receives a role from an invite, and this form cannot assign one.
            {mock ? " Creating an incident replaces the open demo story in this tab." : ""}
          </p>
          <label className="grid gap-2 text-sm" htmlFor="incident-title">
            Title
            <input
              id="incident-title"
              name="title"
              value={title}
              required
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="grid gap-2 text-sm" htmlFor="commander-name">
            Your display name
            <input
              id="commander-name"
              name="display-name"
              value={displayName}
              required
              maxLength={40}
              autoComplete="off"
              onChange={(event) => setDisplayName(event.target.value)}
              className={fieldClass}
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 w-fit items-center justify-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            {pending ? "Creating…" : "Create incident"}
          </button>
        </form>
      )}
    </div>
  );
}
