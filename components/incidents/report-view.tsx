"use client";

import { primaryButtonClass } from "@/components/incidents/form-ui";
import { memberStateLabel, phaseLabel, ROLE_LABELS, taskStatusLabel } from "@/components/incidents/labels";
import { SafeText } from "@/components/incidents/safe-text";
import { memberName } from "@/components/incidents/situation";
import { ScopeList } from "@/components/incidents/scope-list";
import { TimelineList } from "@/components/incidents/timeline-list";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { isMockIncidentClient } from "@/lib/client";
import { projectLegalDeadlines } from "@/lib/legal";
import { formatTimestamp } from "@/lib/time";

export function ReportView() {
  const state = useIncident();
  const now = useBrowserNow();
  const mock = isMockIncidentClient();
  const incident = state.incident;
  if (!incident) return null;
  const awareness = (state.discovery?.determinedAt ?? incident.createdAt).toISOString();
  const deadlines =
    now === null
      ? null
      : projectLegalDeadlines({
          incidentId: incident.id,
          awarenessAt: awareness,
          now: new Date(now),
          materialityDeterminedAt: state.materiality?.determinedAt.toISOString() ?? null,
        });

  return (
    <article id="incident-report" className="grid min-w-0 gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-medium tracking-tight">Report</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            A printable record of status, timeline, scope, tasks, deadlines, roster, evidence, and integrity. Chat is
            omitted from this report, including attorney-client privileged messages.
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className={`${primaryButtonClass} no-print`}>
          Print report
        </button>
      </div>
      {mock ? (
        <p className="text-sm leading-6 text-muted">
          Demo data. Chain heads in this session are placeholders. Signatures are not verified.
        </p>
      ) : null}

      <section aria-labelledby="report-summary">
        <h3 id="report-summary" className="text-sm font-medium">
          Summary
        </h3>
        <p className="mt-3 break-words text-sm leading-6">
          {state.status ? (
            <>
              {`${state.status.severity} · ${phaseLabel(state.status.phase)}. `}
              <SafeText text={state.status.summary} />
            </>
          ) : (
            "No status has been recorded."
          )}
        </p>
        <p className="mt-2 text-sm text-muted">Opened {formatTimestamp(incident.createdAt)}</p>
      </section>

      <section aria-labelledby="report-timeline">
        <h3 id="report-timeline" className="text-sm font-medium">
          Timeline
        </h3>
        <div className="mt-3">
          <TimelineList items={state.timeline} detailed />
        </div>
      </section>

      <section aria-labelledby="report-scope">
        <h3 id="report-scope" className="text-sm font-medium">
          Affected systems
        </h3>
        <div className="mt-3">
          {state.scope.length === 0 ? (
            <p className="text-sm text-muted">No systems recorded yet.</p>
          ) : (
            <ScopeList items={state.scope} />
          )}
        </div>
      </section>

      <section aria-labelledby="report-tasks">
        <h3 id="report-tasks" className="text-sm font-medium">
          Tasks
        </h3>
        {state.tasks.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No tasks yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {state.tasks.map((task) => (
              <li key={task.taskId} className="min-w-0 py-3 text-sm">
                <p className="break-words">
                  <SafeText text={task.latest.title} />
                </p>
                <p className="mt-1 text-muted">
                  {taskStatusLabel(task.latest.status)} · {memberName(state.members, task.latest.assignee)}
                  {task.latest.dueAt ? ` · ${formatTimestamp(task.latest.dueAt)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="report-deadlines">
        <h3 id="report-deadlines" className="text-sm font-medium">
          Deadlines
        </h3>
        <p className="mt-2 text-sm text-muted">Planning clocks. Verify each matter with counsel.</p>
        {deadlines === null ? (
          <p className="mt-3 text-sm text-muted">Notice clocks open with the browser clock.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {deadlines.map((deadline) => (
              <li key={deadline.id} className="min-w-0 py-3 text-sm">
                <p>{deadline.citation}</p>
                <p className="mt-1 text-muted">
                  {deadline.dueAt ? formatTimestamp(deadline.dueAt) : "No due time"}
                  {deadline.scheduleNote ? ` · ${deadline.scheduleNote}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="report-roster">
        <h3 id="report-roster" className="text-sm font-medium">
          Roster
        </h3>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {state.members.map((member) => (
            <li key={member.identity} className="min-w-0 py-3 text-sm">
              <p className="break-words">
                {member.displayName} · {ROLE_LABELS[member.role]} · {memberStateLabel(member.state)}
              </p>
              <p className="mt-1 break-all font-mono text-[11px] text-muted">{member.fingerprint}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="report-evidence">
        <h3 id="report-evidence" className="text-sm font-medium">
          Evidence
        </h3>
        {state.evidence.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No evidence recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {state.evidence.map((item) => (
              <li key={item.body.evidenceId} className="min-w-0 py-3 text-sm">
                <p className="break-words">
                  <SafeText text={item.body.label} />
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-muted">{item.body.sha256}</p>
                <p className="mt-1 break-words text-muted">
                  <SafeText text={item.body.custodian || "No custodian"} />
                  {item.body.location ? (
                    <>
                      {" · "}
                      <SafeText text={item.body.location} />
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="report-integrity">
        <h3 id="report-integrity" className="text-sm font-medium">
          Integrity attestation
        </h3>
        <p className="mt-2 text-sm text-muted">Checked {formatTimestamp(state.integrity.checkedAt)}</p>
        <p className="mt-1 text-sm">{state.integrity.ok ? "Verification passed." : "Verification failed."}</p>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {Object.entries(state.integrity.channels).map(([channel, integrity]) =>
            integrity ? (
              <li key={channel} className="min-w-0 py-3 text-sm">
                <p>
                  #{channel} · seq {integrity.head ? integrity.head.seq.toString() : "none"} ·{" "}
                  {integrity.ok ? "ok" : "failed"}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-muted">
                  {integrity.head?.hashHex ?? "No head"}
                </p>
              </li>
            ) : null,
          )}
        </ul>
        {state.integrity.rosterFailures.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {state.integrity.rosterFailures.map((failure) => (
              <li key={failure.identity} className="break-all text-sm text-alert">
                Roster check failed for {failure.identity}. {failure.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </article>
  );
}
