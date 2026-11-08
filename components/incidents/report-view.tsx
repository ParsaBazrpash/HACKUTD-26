"use client";

import { useState, type ReactNode } from "react";
import { primaryButtonClass } from "@/components/incidents/form-ui";
import { IncidentGate } from "@/components/incidents/incident-gate";
import { SafeText } from "@/components/incidents/safe-text";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { isMockIncidentClient } from "@/lib/client";
import { buildIncidentReport, type IncidentReport, type ReportDeadline, type ReportPrivileged } from "@/lib/report";

export function ReportView() {
  const state = useIncident();
  const now = useBrowserNow();
  const [includePrivileged, setIncludePrivileged] = useState(false);
  const report =
    now === null
      ? buildIncidentReport(state, { now: null, includePrivileged, demo: isMockIncidentClient(), buildSha: readBuildSha() })
      : buildIncidentReport(state, {
          now: new Date(now),
          includePrivileged,
          demo: isMockIncidentClient(),
          buildSha: readBuildSha(),
        });

  return (
    <IncidentGate state={state}>
      {report ? (
        <ReportDocument report={report} includePrivileged={includePrivileged} onIncludePrivileged={setIncludePrivileged} />
      ) : (
        <p className="text-sm text-muted">Opening the incident…</p>
      )}
    </IncidentGate>
  );
}

function ReportDocument({
  report,
  includePrivileged,
  onIncludePrivileged,
}: {
  report: IncidentReport;
  includePrivileged: boolean;
  onIncludePrivileged: (value: boolean) => void;
}) {
  return (
    <article id="incident-report" className="grid min-w-0 gap-8 text-sm leading-6">
      {report.privileged.watermark ? (
        <div className="privileged-watermark" aria-hidden="true">
          <span>{report.privileged.watermark}</span>
        </div>
      ) : null}

      <header className="print-keep">
        <p className="print-accent font-mono text-[11px] tracking-[0.2em] text-signal">HAVEN</p>
        <h2 className="mt-2 text-2xl font-medium tracking-tight">Incident response report</h2>
        <p className="mt-3 break-words text-lg text-foreground">
          <SafeText text={report.title} />
        </p>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <Fact label="Incident ID" value={report.incidentId} mono />
          <Fact label="Exported" value={report.exportedAt ?? "Export time opens with the browser clock."} />
          <Fact label="Severity" value={report.severity} />
          <Fact label="Phase" value={report.phase} />
        </dl>
        {report.connectionNote ? <p className="mt-3 text-muted">{report.connectionNote}</p> : null}
        {report.demoNote ? <p className="mt-3 text-muted">{report.demoNote}</p> : null}
        <div className="no-print mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => window.print()} className={primaryButtonClass}>
            Print or save as PDF
          </button>
          <p className="text-xs text-muted">Opens the browser print dialog. Choose Save as PDF there.</p>
        </div>
      </header>

      <ReportSection title="Incident summary" first>
        <p className="break-words">
          <SafeText text={report.summary} />
        </p>
      </ReportSection>

      <ReportSection title="Discovery and materiality">
        <div className="grid gap-4 sm:grid-cols-2">
          <Determination determination={report.discovery} />
          <Determination determination={report.materiality} />
        </div>
      </ReportSection>

      <ReportSection title="Timeline of actions">
        {report.timelineEmpty ? (
          <p className="text-muted">{report.timelineEmpty}</p>
        ) : (
          <div className="grid gap-6">
            {report.timeline.map((group) => (
              <div key={group.phase}>
                <h4 className="print-accent text-sm font-medium text-signal">{group.phase}</h4>
                <ol className="mt-2 divide-y divide-line border-y border-line">
                  {group.entries.map((entry) => (
                    <li key={entry.id} className="grid gap-1 py-3">
                      <p className="text-muted">
                        {entry.occurredAt} · {entry.csf}
                      </p>
                      <p className="break-words">
                        <SafeText text={entry.text} />
                      </p>
                      <p className="text-xs text-muted">
                        {entry.author}
                        {entry.signedAt ? ` · signed ${entry.signedAt}` : ""}
                        {` · server ${entry.serverAt}`}
                      </p>
                      {entry.amendment ? <p className="text-xs text-muted">{entry.amendment}</p> : null}
                      {entry.verdict ? <p className="text-xs text-alert">{entry.verdict}</p> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </ReportSection>

      <ReportSection title="Affected systems">
        {report.systemsEmpty ? (
          <p className="text-muted">{report.systemsEmpty}</p>
        ) : (
          <div className="grid gap-4">
            {report.systems.map((system) => (
              <article key={system.id} className="print-keep border-t border-line pt-3">
                <h4 className="break-words font-medium">
                  <SafeText text={system.name} />
                </h4>
                <p className="text-muted">
                  {system.status} · {system.asset}
                </p>
                <p>{system.data}</p>
                <p className="text-muted">Records {system.records}</p>
                <p className="break-words text-muted">{system.residents}</p>
                {system.euResidents ? <p className="text-muted">EU residents {system.euResidents}</p> : null}
                {system.notes ? (
                  <p className="mt-1 break-words">
                    <SafeText text={system.notes} />
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </ReportSection>

      <ReportSection title="Response tasks">
        {report.tasksEmpty ? (
          <p className="text-muted">{report.tasksEmpty}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {report.tasks.map((task) => (
              <li key={task.id} className="print-keep py-3">
                <p className="break-words">
                  <SafeText text={task.title} />
                </p>
                <p className="text-muted">
                  {task.status} · {task.owner} · {task.due}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ReportSection>

      <ReportSection title="Evidence">
        {report.evidenceEmpty ? (
          <p className="text-muted">{report.evidenceEmpty}</p>
        ) : (
          <div className="grid gap-4">
            {report.evidence.map((item) => (
              <article key={item.id} className="print-keep border-t border-line pt-3">
                <h4 className="break-words font-medium">
                  <SafeText text={item.label} />
                </h4>
                <p className="text-muted">SHA-256</p>
                <p className="break-all font-mono text-xs">{item.sha256}</p>
                <p className="break-words text-muted">
                  <SafeText text={item.custodian} />
                  {" · "}
                  <SafeText text={item.location} />
                  {` · ${item.recordedAt}`}
                </p>
              </article>
            ))}
          </div>
        )}
      </ReportSection>

      <ReportSection title="Legal deadlines">
        <p>{report.disclaimer}</p>
        <p className="mt-2 text-muted">{report.counselWarning}</p>
        {report.deadlinesEmpty ? <p className="mt-3 text-muted">{report.deadlinesEmpty}</p> : null}
        {report.deadlines && report.deadlines.length > 0 ? (
          <div className="mt-4 grid gap-4">
            {report.deadlines.map((deadline) => (
              <DeadlineBlock key={deadline.id} deadline={deadline} />
            ))}
          </div>
        ) : null}
      </ReportSection>

      <ReportSection title="Team roles">
        {report.rosterEmpty ? (
          <p className="text-muted">{report.rosterEmpty}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {report.roster.map((member) => (
              <li key={`${member.name}-${member.fingerprint}`} className="print-keep py-3">
                <p className="break-words">
                  <SafeText text={member.name} /> · {member.role} · {member.state}
                </p>
                <p className="break-all font-mono text-xs text-muted">{member.fingerprint}</p>
                <p className="text-xs text-muted">
                  Joined {member.joinedAt} · Admitted {member.admittedAt}
                  {member.revokedAt ? ` · Revoked ${member.revokedAt}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ReportSection>

      <ReportSection title="Integrity verification">
        <p>{report.integrity.summary}</p>
        <p className="mt-2 text-muted">Checked {report.integrity.checkedAt}</p>
        <p className="mt-2 break-all">Commander fingerprint {report.integrity.commanderFingerprint}</p>
        <p className="mt-1 break-all text-muted">{report.integrity.build}</p>
        {report.integrity.rosterFailures.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {report.integrity.rosterFailures.map((failure) => (
              <li key={failure} className="break-all text-alert">
                {failure}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-muted">No roster failures are on this check.</p>
        )}
        {report.integrity.channels.length === 0 ? (
          <p className="mt-3 text-muted">No channel head is available to this client.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            {report.integrity.channels.map((channel) => (
              <article key={channel.channel} className="print-keep border-t border-line pt-3">
                <h4 className="font-medium">
                  {channel.channel} · {channel.result}
                </h4>
                <p className="text-muted">{channel.eventsChecked} events checked</p>
                <p className="break-all">{channel.head}</p>
                <p className="text-muted">{channel.pinned}</p>
                <p>{channel.checkpoint}</p>
                {channel.failures.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {channel.failures.map((failure) => (
                      <li key={failure} className="break-words text-alert">
                        {failure}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </ReportSection>

      <PrivilegedSection
        privileged={report.privileged}
        includePrivileged={includePrivileged}
        onIncludePrivileged={onIncludePrivileged}
      />
    </article>
  );
}

function PrivilegedSection({
  privileged,
  includePrivileged,
  onIncludePrivileged,
}: {
  privileged: ReportPrivileged;
  includePrivileged: boolean;
  onIncludePrivileged: (value: boolean) => void;
}) {
  return (
    <ReportSection title="Privileged communications">
      {privileged.included ? (
        <p className="print-accent border border-signal px-3 py-2 font-medium text-signal">PRIVILEGED / CONFIDENTIAL</p>
      ) : null}
      <p className={privileged.included ? "mt-3" : undefined}>{privileged.note}</p>
      {privileged.offered ? (
        <label className="no-print mt-3 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-signal"
            checked={includePrivileged}
            onChange={(event) => onIncludePrivileged(event.target.checked)}
          />
          <span>
            Include attorney-client privileged messages
            <span className="mt-1 block text-muted">
              This adds a PRIVILEGED / CONFIDENTIAL watermark. Only messages from the privileged channel already open in this client are added.
            </span>
          </span>
        </label>
      ) : null}
      {privileged.included && privileged.messages.length === 0 ? (
        <p className="mt-3 text-muted">The privileged channel has no messages to include.</p>
      ) : null}
      {privileged.included && privileged.messages.length > 0 ? (
        <ol className="mt-3 divide-y divide-line border-y border-line">
          {privileged.messages.map((message, index) => (
            <li key={`${message.at}-${index}`} className="py-3">
              <p className="break-words">
                <SafeText text={message.text} />
              </p>
              <p className="text-xs text-muted">
                {message.author} · {message.at}
              </p>
              {message.verdict ? <p className="text-xs text-alert">{message.verdict}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </ReportSection>
  );
}

function Determination({ determination }: { determination: IncidentReport["discovery"] }) {
  return (
    <article className="print-keep min-w-0 border-t border-line pt-3">
      <h4 className="font-medium">{determination.label}</h4>
      {determination.recorded ? (
        <>
          <p>
            {determination.at} · {determination.by}
          </p>
          <p className="break-words text-muted">
            <SafeText text={determination.basis} />
          </p>
        </>
      ) : (
        <p className="text-muted">Not recorded</p>
      )}
    </article>
  );
}

function DeadlineBlock({ deadline }: { deadline: ReportDeadline }) {
  return (
    <article className="print-keep border-t border-line pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-medium">{deadline.name}</h4>
        {deadline.urgent ? <p className="print-accent text-xs font-medium text-signal">Most urgent</p> : null}
      </div>
      <p className="text-muted">{deadline.jurisdiction}</p>
      <dl className="mt-2 grid gap-1">
        <Row label="Applicability" value={deadline.applicability} />
        <Row label="Trigger" value={deadline.trigger} />
        <Row label="Deadline" value={deadline.due} />
        <Row label="Countdown" value={deadline.countdown} />
        <Row label="Status" value={deadline.status} />
        <Row label="Citation" value={deadline.citation} />
      </dl>
      {deadline.sourceUrl ? (
        <p className="mt-2 break-all">
          <a href={deadline.sourceUrl} rel="noopener noreferrer" className="underline decoration-signal/40 underline-offset-2">
            {deadline.sourceUrl}
          </a>
        </p>
      ) : (
        <p className="mt-2 text-muted">No official link is recorded for this rule.</p>
      )}
      <p className="mt-2 break-words text-muted">
        <SafeText text={deadline.explanation} />
      </p>
      {deadline.recorded ? (
        <p className="mt-2 break-words">
          <SafeText text={deadline.recorded} />
        </p>
      ) : null}
    </article>
  );
}

function ReportSection({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <section className={first ? undefined : "print-section"} aria-labelledby={sectionId(title)}>
      <h3 id={sectionId(title)} className="print-accent text-base font-medium tracking-tight text-foreground">
        {title}
      </h3>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 border-t border-line pt-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs" : "break-words"}>{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

function sectionId(title: string): string {
  return `report-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function readBuildSha(): string | null {
  const value = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim() ?? "";
  if (!/^[0-9a-f]{7,64}$/i.test(value)) return null;
  return value.toLowerCase();
}
