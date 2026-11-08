"use client";

import { useState } from "react";
import { FormError, primaryButtonClass, secondaryButtonClass } from "@/components/incidents/form-ui";
import { ROLE_LABELS } from "@/components/incidents/labels";
import {
  canPage,
  latestPages,
  pageChip,
  reachability,
  showImHere,
  type ChipTone,
} from "@/components/incidents/paging";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { formatTimestamp } from "@/lib/time";

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "border-line text-muted",
  progress: "border-signal text-signal",
  good: "border-verified text-verified",
  alert: "border-alert text-alert",
};

/** Live status per paged person, with Retry call. Commander only. */
export function PagingStatus() {
  const state = useIncident();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!canPage(state)) return null;
  const pages = latestPages(state.pages);
  if (pages.length === 0) return null;

  async function retry(orgMemberId: bigint) {
    setBusyId(orgMemberId.toString());
    setError(null);
    try {
      await getIncidentClient().page([orgMemberId]);
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel px-5 py-4" aria-labelledby="paging-status-heading">
      <h2 id="paging-status-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
        PAGE STATUS
      </h2>
      <ul className="mt-3 divide-y divide-line" aria-live="polite">
        {pages.map((page) => {
          const chip = pageChip(page);
          const id = page.orgMemberId.toString();
          return (
            <li key={id} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="break-words text-sm text-foreground">
                  {page.displayName}
                  <span className="text-muted"> · {ROLE_LABELS[page.role]}</span>
                </p>
                <p className="mt-1 text-xs text-muted">Updated {formatTimestamp(page.updatedAt)}</p>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-medium ${TONE_CLASS[chip.tone]}`}>
                  {chip.label}
                </span>
                {chip.retry ? (
                  <button
                    type="button"
                    disabled={busyId === id}
                    onClick={() => void retry(page.orgMemberId)}
                    className={secondaryButtonClass}
                  >
                    Retry call
                  </button>
                ) : null}
              </div>
              {chip.hint ? <p className="text-xs text-muted sm:col-span-2">{chip.hint}</p> : null}
            </li>
          );
        })}
      </ul>
      <FormError message={error} />
    </section>
  );
}

/** Compact "Who is reachable" strip for the Overview. Commander only. */
export function ReachableStrip() {
  const state = useIncident();
  if (!canPage(state) || state.pages.length === 0) return null;
  const counts = reachability(state.pages);
  const names = [...counts.joinedNames, ...counts.acknowledgedNames];
  return (
    <section
      className="mt-3 min-w-0 rounded-xl border border-line bg-panel px-4 py-3 sm:px-5"
      aria-labelledby="reachable-heading"
    >
      <h2 id="reachable-heading" className="text-base font-semibold tracking-tight">
        Who is reachable
      </h2>
      <p className="mt-1 text-sm text-muted" aria-live="polite">
        {counts.paged} paged, {counts.acknowledged + counts.joined} acknowledged, {counts.joined} joined.
        {names.length > 0 ? ` ${names.join(", ")}.` : ""}
      </p>
    </section>
  );
}

/** "I'm here" for a member added from the roster who has not posted yet. */
export function ImHereButton() {
  const state = useIncident();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!showImHere(state)) return null;

  async function announce() {
    setBusy(true);
    setError(null);
    try {
      await getIncidentClient().announcePresence();
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-signal bg-panel px-5 py-4" aria-labelledby="im-here-heading">
      <h2 id="im-here-heading" className="text-base font-semibold tracking-tight">
        Let the room know you are here
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        This posts a signed &quot;I&apos;m here&quot; message. Until then the commander only has the phone
        acknowledgement.
      </p>
      <div className="mt-3">
        <button type="button" disabled={busy} onClick={() => void announce()} className={primaryButtonClass}>
          I&apos;m here
        </button>
      </div>
      <FormError message={error} />
    </section>
  );
}
