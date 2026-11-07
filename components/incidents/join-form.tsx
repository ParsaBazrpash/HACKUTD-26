"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { DemoBanner } from "@/components/incidents/demo-banner";
import { ROLE_LABELS } from "@/components/incidents/labels";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { Role } from "@/spacetimedb/src/shared/policy";

const fieldClass =
  "rounded-xl border border-line bg-panel px-3 py-2 text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

function fragmentKind(fragment: string): "demo" | "live" | "unknown" {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  if (params.has("c") || params.has("s") || params.has("f")) return "live";
  if (params.get("demo") === "1") return "demo";
  return "unknown";
}

function inviteRoleLabel(fragment: string): string | null {
  const role = new URLSearchParams(fragment.replace(/^#/, "")).get("r");
  if (role === "counsel" || role === "technical" || role === "executive") return ROLE_LABELS[role];
  return null;
}

function emptyInviteFragment(): null {
  return null;
}

/**
 * Reads the invite fragment once, then removes it from the address bar.
 * The first snapshot is null so server render and hydration match.
 */
function useInviteFragment(): string | null {
  const box = useRef({
    value: null as string | null,
    ready: false,
    listeners: new Set<() => void>(),
  });
  const subscribe = useCallback((listener: () => void) => {
    const current = box.current;
    current.listeners.add(listener);
    if (!current.ready) {
      current.ready = true;
      const hash = window.location.hash;
      current.value = hash.length > 1 ? hash : "";
      if (hash.length > 1) window.history.replaceState(null, "", "/join");
      queueMicrotask(() => {
        for (const item of current.listeners) item();
      });
    }
    return () => {
      current.listeners.delete(listener);
    };
  }, []);
  const getSnapshot = useCallback(() => box.current.value, []);
  return useSyncExternalStore(subscribe, getSnapshot, emptyInviteFragment);
}

export function JoinForm() {
  const mock = isMockIncidentClient();
  const fragment = useInviteFragment();
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ role: Role; name: string; incidentId: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fragment) return;
    setPending(true);
    setError(null);
    try {
      const client = getIncidentClient();
      await client.redeemInvite({ fragment, displayName });
      const next = client.getState();
      if (next.me && next.incident) {
        setJoined({ role: next.me.role, name: next.me.displayName, incidentId: next.incident.id });
      }
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  const role = fragment ? inviteRoleLabel(fragment) : null;
  const kind = fragment ? fragmentKind(fragment) : null;

  return (
    <div className="grid max-w-xl gap-5">
      <DemoBanner />
      {fragment === null ? <p className="text-sm text-muted">Reading the invite link…</p> : null}
      {fragment === "" && !joined ? (
        <p className="text-sm leading-6 text-muted">
          No invite link is loaded. Open the link from your commander. This page cannot assign a role.
        </p>
      ) : null}
      {fragment && role ? (
        <p className="text-sm text-foreground">
          Role from the invite: {role}. This page cannot change it.
        </p>
      ) : null}
      {fragment && !role ? (
        <p className="text-sm text-muted">The role stays on the invite. This page cannot choose one.</p>
      ) : null}
      {mock && kind === "live" ? (
        <p className="text-sm text-alert">Demo mode cannot open a live invite link.</p>
      ) : null}
      {!mock && kind === "demo" ? (
        <p className="text-sm text-alert">This is a demo link. It cannot be redeemed by the live client.</p>
      ) : null}
      {mock && kind === "demo" ? (
        <p className="text-sm text-muted">Demo invite. It is a tab-local token, not a cryptographic link.</p>
      ) : null}

      {joined ? null : (
        <form onSubmit={submit} className="grid gap-5">
          <label className="grid gap-2 text-sm" htmlFor="display-name">
            Display name
            <input
              id="display-name"
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
            disabled={pending || !fragment || !displayName.trim()}
            className="inline-flex w-fit items-center justify-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            {pending ? "Joining…" : "Redeem invite"}
          </button>
        </form>
      )}

      {joined ? (
        <div role="status" className="rounded-xl border border-line bg-panel px-4 py-3 text-sm">
          <p>
            Waiting as {ROLE_LABELS[joined.role]}. {joined.name}.
          </p>
          <Link
            href={`/incidents/${joined.incidentId}`}
            className="mt-3 inline-flex text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Open this room
          </Link>
        </div>
      ) : null}
    </div>
  );
}
