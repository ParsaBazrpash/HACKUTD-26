"use client";

import { useState, type FormEvent } from "react";
import { Denied, fieldClass, FormError, FormStatus, primaryButtonClass } from "@/components/incidents/form-ui";
import { ROLE_LABELS } from "@/components/incidents/labels";
import {
  BASIS_MAX,
  BASIS_PRESETS,
  DETERMINATION_COPY,
  NOTE_PRESETS,
  STATUS_LABELS,
  deadlineOwners,
  draftDeadlineMark,
  draftDetermination,
  parseLocalInput,
  toLocalSecondsValue,
  zoneEcho,
  type DeterminationKind,
} from "@/components/incidents/legal-inputs";
import { canAuthorRecord, recordDenial } from "@/components/incidents/record-actions";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { IncidentState, MemberView } from "@/lib/client/types";
import { computeDeadlines, formatLegalInstant } from "@/lib/legal";
import { DEADLINE_STATUSES } from "@/lib/protocol/events";
import { localTimeZone } from "@/lib/time";

const chipClass =
  "inline-flex min-h-8 items-center rounded-full border border-line px-3 text-xs text-muted hover:border-signal hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export function LegalWriteNote() {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "legal.discovery");
  if (allowed) return null;
  return <Denied>{recordDenial("legal.discovery")}</Denied>;
}

export function DeterminationForm({
  kind,
  determinedAt,
  basis,
  onSaved,
}: {
  kind: DeterminationKind;
  determinedAt?: Date;
  basis?: string;
  onSaved?: (message: string) => void;
}) {
  const state = useIncident();
  const now = useBrowserNow();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, kind);
  const copy = DETERMINATION_COPY[kind];
  const [time, setTime] = useState(determinedAt ? toLocalSecondsValue(determinedAt) : "");
  const [text, setText] = useState(basis ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const prefix = kind === "legal.discovery" ? "discovery" : "materiality";
  const timeId = `${prefix}-time`;
  const basisId = `${prefix}-basis`;
  const helpId = `${prefix}-help`;
  const draftAt = parseLocalInput(time);
  const replacing = Boolean(determinedAt && draftAt && draftAt.getTime() !== determinedAt.getTime());
  const preview = draftAt && now !== null ? previewClocks(state, kind, draftAt, text, now) : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAuthorRecord(state.me?.role, state.me?.state, kind)) {
      setError(recordDenial(kind));
      setSaved(null);
      return;
    }
    const draft = draftDetermination({
      kind,
      value: time,
      basis: text,
      now: Date.now(),
      discoveryAt: state.discovery?.determinedAt ?? null,
    });
    if (!draft.ok) {
      setError(draft.reason);
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const client = getIncidentClient();
      if (kind === "legal.discovery") await client.recordDiscovery(draft.body);
      else await client.recordMateriality(draft.body);
      setSaved(copy.saved);
      onSaved?.(copy.saved);
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!allowed) return null;

  const button = determinedAt ? `Update ${copy.title.toLowerCase()}` : `Record ${copy.title.toLowerCase()}`;

  return (
    <form onSubmit={submit} className="no-print grid gap-4" aria-label={button}>
      <div className="grid gap-2 text-sm">
        <label htmlFor={timeId} className="font-medium text-foreground">
          {copy.question}
        </label>
        <p id={helpId} className="text-xs leading-5 text-muted">
          {copy.help}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={timeId}
            type="datetime-local"
            step={1}
            value={time}
            max={now !== null ? toLocalSecondsValue(new Date(now)) : undefined}
            onChange={(event) => setTime(event.target.value)}
            aria-describedby={helpId}
            className={`${fieldClass} w-auto flex-1`}
            required
          />
          <button type="button" className={chipClass} onClick={() => setTime(toLocalSecondsValue(new Date()))}>
            Now
          </button>
        </div>
        <p className="text-xs text-muted">
          {draftAt ? `Your zone ${localTimeZone()} · ${zoneEcho(draftAt)}` : `Times are read in your zone, ${localTimeZone()}.`}
        </p>
      </div>

      <div className="grid gap-2 text-sm">
        <label htmlFor={basisId} className="font-medium text-foreground">
          {copy.basisLabel}
        </label>
        <div className="flex flex-wrap gap-2" aria-label="Starting points">
          {BASIS_PRESETS[kind].map((preset) => (
            <button key={preset.label} type="button" className={chipClass} onClick={() => setText(preset.text)}>
              {preset.label}
            </button>
          ))}
        </div>
        <textarea
          id={basisId}
          value={text}
          maxLength={BASIS_MAX}
          rows={3}
          required
          onChange={(event) => setText(event.target.value)}
          className={`${fieldClass} min-h-24`}
        />
        <p className="text-right font-mono text-[11px] text-muted">
          {text.length}/{BASIS_MAX}
        </p>
      </div>

      {preview.length > 0 ? (
        <div className="rounded-lg border border-line px-3 py-3 text-sm" aria-live="polite">
          <p className="text-xs font-medium text-muted">{determinedAt ? "If you save, these dates change" : "If you save, these clocks start"}</p>
          <ul className="mt-2 grid gap-1">
            {preview.map((line) => (
              <li key={line.id} className="flex flex-wrap justify-between gap-2">
                <span>{line.name}</span>
                <span className="font-mono text-xs text-muted">{line.due}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {replacing && determinedAt ? (
        <p className="text-xs leading-5 text-signal">
          This replaces the time on the record. The earlier entry stays in the signed history.
        </p>
      ) : null}
      <FormError message={error} />
      <FormStatus message={saved} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-fit`}>
        {pending ? "Recording…" : button}
      </button>
    </form>
  );
}

/** Runs the engine on the draft so the person sees which clocks start or move before saving. */
function previewClocks(
  state: IncidentState,
  kind: DeterminationKind,
  at: Date,
  basis: string,
  now: number,
): { id: string; name: string; due: string }[] {
  if (at.getTime() > now) return [];
  const by = state.me ?? state.incident?.commander;
  if (!by) return [];
  const entry = { determinedAt: at, basis, by };
  const draft: IncidentState = kind === "legal.discovery" ? { ...state, discovery: entry } : { ...state, materiality: entry };
  const before = new Map(computeDeadlines(state, new Date(now)).map((row) => [row.rule.id, row.dueAt?.getTime() ?? null]));
  const zone = localTimeZone();
  return computeDeadlines(draft, new Date(now))
    .filter((row) => row.applicability === "applies" && row.dueAt && before.get(row.rule.id) !== row.dueAt.getTime())
    .map((row) => ({ id: row.rule.id, name: row.rule.name, due: formatLegalInstant(row.dueAt!, zone) }));
}

/** The two profile facts the Winstead rules read. Other stored flags are passed through unchanged. */
export function ProfileForm({ onSaved }: { onSaved?: (message: string) => void }) {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "profile.set");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: "hipaaCoveredEntity" | "publicCompany", value: boolean) {
    if (!allowed) return;
    setPending(key);
    setError(null);
    try {
      await getIncidentClient().setProfile({ ...state.profile, [key]: value });
      onSaved?.("Organization profile recorded.");
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPending(null);
    }
  }

  const rows = [
    {
      key: "hipaaCoveredEntity" as const,
      label: "HIPAA covered entity",
      help: "A clinic, health plan, or provider. Turns on the three HIPAA notices when PHI is exposed.",
    },
    {
      key: "publicCompany" as const,
      label: "Public company",
      help: "Files with the SEC. Turns on Form 8-K once materiality is recorded.",
    },
  ];

  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const on = state.profile[row.key];
        return (
          <div key={row.key} className="flex items-start justify-between gap-4 border-b border-line pb-3">
            <div className="min-w-0">
              <p className="text-sm text-foreground">{row.label}</p>
              <p className="mt-1 text-xs leading-5 text-muted">{row.help}</p>
            </div>
            {allowed ? (
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={row.label}
                disabled={pending !== null}
                onClick={() => toggle(row.key, !on)}
                className={`no-print relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${
                  on ? "border-signal bg-signal" : "border-line bg-panel-raised"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full transition-transform ${on ? "translate-x-6 bg-signal-ink" : "translate-x-1 bg-muted"}`}
                />
              </button>
            ) : (
              <span className="text-sm">{on ? "Yes" : "No"}</span>
            )}
          </div>
        );
      })}
      {OTHER_FLAGS.filter(([key]) => state.profile[key]).map(([key, label]) => (
        <p key={key} className="text-xs leading-5 text-muted">
          Also on record: {label}. Not computed here; see the counsel row above.
        </p>
      ))}
      <FormError message={error} />
    </div>
  );
}

const OTHER_FLAGS = [
  ["euDataSubjects", "EU data subjects"],
  ["nydfsRegulated", "NYDFS regulated"],
  ["defenseContractor", "Defense contractor"],
  ["bank", "Bank"],
] as const;

export function DeadlineStatusForm({
  ruleId,
  ruleName,
  status,
  owner,
  note,
  onSaved,
}: {
  ruleId: string;
  ruleName: string;
  status?: string;
  owner?: string;
  note?: string;
  onSaved?: (message: string) => void;
}) {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "deadline.update");
  const [nextStatus, setNextStatus] = useState<string>(status && status in STATUS_LABELS ? status : "open");
  const [nextOwner, setNextOwner] = useState(owner ?? "");
  const [nextNote, setNextNote] = useState(note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const owners = deadlineOwners(state.members, owner);
  const ownerId = `deadline-owner-${ruleId}`;
  const noteId = `deadline-note-${ruleId}`;
  const presets = NOTE_PRESETS[nextStatus as (typeof DEADLINE_STATUSES)[number]] ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAuthorRecord(state.me?.role, state.me?.state, "deadline.update")) {
      setError(recordDenial("deadline.update"));
      setSaved(null);
      return;
    }
    const draft = draftDeadlineMark({ ruleId, status: nextStatus, owner: nextOwner, note: nextNote });
    if (!draft.ok) {
      setError(draft.reason);
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await getIncidentClient().updateDeadline(draft.body);
      const message = "Deadline status recorded.";
      setSaved(message);
      onSaved?.(message);
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!allowed || !/^[a-z0-9-]{1,40}$/.test(ruleId)) return null;

  return (
    <form onSubmit={submit} className="no-print grid gap-4" aria-label={`Update ${ruleName}`}>
      <fieldset className="grid gap-2 text-sm">
        <legend className="mb-2 font-medium text-foreground">Where is this notice?</legend>
        <div className="flex flex-wrap gap-2">
          {DEADLINE_STATUSES.map((value) => {
            const active = nextStatus === value;
            return (
              <label
                key={value}
                className={`inline-flex min-h-9 cursor-pointer items-center rounded-lg border px-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal ${
                  active ? "border-signal text-foreground" : "border-line text-muted hover:text-foreground"
                }`}
              >
                <input
                  type="radio"
                  name={`deadline-status-${ruleId}`}
                  value={value}
                  checked={active}
                  onChange={() => setNextStatus(value)}
                  className="sr-only"
                />
                {STATUS_LABELS[value]}
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="grid gap-2 text-sm" htmlFor={ownerId}>
        <span className="font-medium text-foreground">Owner</span>
        <select id={ownerId} value={nextOwner} onChange={(event) => setNextOwner(event.target.value)} className={fieldClass}>
          <option value="">Unassigned</option>
          {owners.map((member) => (
            <option key={member.identity} value={member.identity}>
              {memberLabel(member)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-2 text-sm">
        <label htmlFor={noteId} className="font-medium text-foreground">
          Note{nextStatus === "done" || nextStatus === "not_applicable" ? " (required)" : ""}
        </label>
        {presets.length > 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Starting points">
            {presets.map((text) => (
              <button key={text} type="button" className={chipClass} onClick={() => setNextNote(text)}>
                {text}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          id={noteId}
          value={nextNote}
          maxLength={1000}
          rows={2}
          onChange={(event) => setNextNote(event.target.value)}
          className={`${fieldClass} min-h-20`}
        />
      </div>
      <p className="text-xs text-muted">This tracks the work. It does not move the legal due date.</p>
      <FormError message={error} />
      <FormStatus message={saved} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-fit`}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function memberLabel(member: MemberView): string {
  const suffix = member.state === "active" ? "" : " (no longer active)";
  return `${member.displayName} · ${ROLE_LABELS[member.role]}${suffix}`;
}
