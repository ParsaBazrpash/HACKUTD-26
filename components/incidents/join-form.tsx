"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useIncidentList } from "@/hooks/use-incident-data";
import { SpacetimeModuleNotReadyError, UnknownIncidentError } from "@/lib/data";
import { ROLE_LABELS, roleSchema, type Role } from "@/types/common";
import type { JoinIncidentInput, MemberShell } from "@/types/shells";

export function JoinForm() {
  const params = useSearchParams();
  const { incidents, client, error: clientError, mode } = useIncidentList();
  const requested = params.get("incident");
  const preferredId =
    incidents.find((incident) => incident.id === requested)?.id ?? incidents[0]?.id ?? "";
  const [chosenId, setChosenId] = useState<string | null>(null);
  const incidentId = chosenId ?? preferredId;
  const [role, setRole] = useState<Role | "">("");
  const [localName, setLocalName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [member, setMember] = useState<MemberShell | null>(null);

  if (clientError || mode === "unavailable") {
    return (
      <p role="alert" className="text-sm text-alert">
        {clientError ?? "The incident client is unavailable."}
      </p>
    );
  }

  if (mode !== "mock" || !client) {
    return (
      <p className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">
        SpacetimeDB is selected, and the module is not connected. Join was not sent.
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !role || !incidentId) return;

    const input: JoinIncidentInput = { incidentId, role };
    setPending(true);
    setError(null);
    try {
      const joined = await client.joinIncident(input);
      setMember(joined);
    } catch (cause) {
      if (cause instanceof UnknownIncidentError || cause instanceof SpacetimeModuleNotReadyError) {
        setError(cause.message);
      } else {
        setError("The room could not be joined.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-5">
      <label className="grid gap-2 text-sm" htmlFor="incident-id">
        Incident
        <select
          id="incident-id"
          name="incident"
          value={incidentId}
          onChange={(event) => setChosenId(event.target.value)}
          className="rounded-xl border border-line bg-panel px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <option value="" disabled>
            Select a room
          </option>
          {incidents.map((incident) => (
            <option key={incident.id} value={incident.id}>
              {incident.id}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-2 text-sm" htmlFor="role">
        Role
        <select
          id="role"
          name="role"
          value={role}
          required
          onChange={(event) => {
            const parsed = roleSchema.safeParse(event.target.value);
            setRole(parsed.success ? parsed.data : "");
          }}
          className="rounded-xl border border-line bg-panel px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <option value="" disabled>
            Select a role
          </option>
          {roleSchema.options.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABELS[option]}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-2 text-sm" htmlFor="local-name">
        Local label
        <input
          id="local-name"
          name="local-name"
          value={localName}
          maxLength={80}
          autoComplete="off"
          onChange={(event) => setLocalName(event.target.value)}
          placeholder="Optional, this tab only"
          className="rounded-xl border border-line bg-panel px-3 py-2 text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        />
        <span className="text-xs leading-5 text-muted">
          Kept in this tab. It is not passed to the data client, and no key is generated.
        </span>
      </label>

      {error ? (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !incidentId || !role}
        className="inline-flex w-fit items-center justify-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        {pending ? "Joining…" : "Join room"}
      </button>

      {member ? (
        <div role="status" className="rounded-xl border border-line bg-panel px-4 py-3 text-sm">
          <p>
            Joined as {ROLE_LABELS[member.role]}. Member {member.id}.
          </p>
          {localName.trim() ? <p className="mt-2 text-muted">Local label: {localName.trim()}</p> : null}
          <Link
            href={`/incidents/${member.incidentId}`}
            className="mt-3 inline-flex text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Open this room
          </Link>
        </div>
      ) : null}
    </form>
  );
}
