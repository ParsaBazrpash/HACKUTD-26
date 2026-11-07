"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { HourClock } from "@/components/incidents/hour-clock";
import { DemoBanner } from "@/components/incidents/demo-banner";
import {
  CHANNEL_LABELS,
  ROLE_LABELS,
  assetLabel,
  connectionLabel,
  dataTypeLabel,
  memberStateLabel,
  phaseLabel,
  scopeStatusLabel,
  taskStatusLabel,
} from "@/components/incidents/labels";
import { SafeText } from "@/components/incidents/safe-text";
import { IntegrityMark } from "@/components/ui/integrity-mark";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { IncidentClient, IncidentState, MemberView } from "@/lib/client/types";
import { projectLegalDeadlines } from "@/lib/legal";
import type { LegalDeadlineStatus } from "@/lib/legal";
import { formatTimestamp } from "@/lib/time";

function deadlineClass(status: LegalDeadlineStatus): string {
  if (status === "elapsed") return "text-alert";
  if (status === "due") return "text-signal";
  if (status === "upcoming") return "text-verified";
  return "text-muted";
}

const deadlineLabels: Record<LegalDeadlineStatus, string> = {
  upcoming: "Inside the window",
  due: "Inside six hours",
  elapsed: "Window passed",
  unscheduled: "Not scheduled",
};

function NoticeClocks({ incidentId, awarenessAt }: { incidentId: string; awarenessAt: string }) {
  const browserNow = useBrowserNow();
  const deadlines =
    browserNow === null
      ? null
      : projectLegalDeadlines({
          incidentId,
          awarenessAt,
          now: new Date(browserNow),
        });

  return (
    <section className="mt-8" aria-labelledby="clocks-heading">
      <h2 id="clocks-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
        NOTICE CLOCKS
      </h2>
      {deadlines === null ? (
        <p className="mt-3 text-sm text-muted">Notice clocks open with the browser clock.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {deadlines.map((deadline) => (
            <li key={deadline.id} className="grid gap-2 py-4 sm:grid-cols-[11rem_1fr]">
              <div>
                <p className={`font-mono text-xs ${deadlineClass(deadline.status)}`}>
                  {deadlineLabels[deadline.status]}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {deadline.dueAt ? formatTimestamp(deadline.dueAt) : "No due time"}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{deadline.citation}</p>
                <p className="mt-1 text-sm leading-6 text-muted">{deadline.obligation}</p>
                {deadline.scheduleNote ? (
                  <p className="mt-2 text-sm text-foreground">{deadline.scheduleNote}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function memberName(members: MemberView[], identity: string | undefined): string {
  if (!identity) return "Unassigned";
  return members.find((member) => member.identity === identity)?.displayName ?? "Unknown member";
}

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel px-5 py-4" aria-labelledby={id}>
      <h2 id={id} className="font-mono text-[11px] tracking-[0.18em] text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function IncidentDetail({ incidentId }: { incidentId: string }) {
  const state = useIncident();
  const mock = isMockIncidentClient();
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let client: IncidentClient;
    try {
      client = getIncidentClient();
    } catch (cause) {
      const message = clientErrorMessage(cause);
      queueMicrotask(() => {
        if (!cancelled) setOpenError(message);
      });
      return () => {
        cancelled = true;
      };
    }
    if (client.getState().incident?.id === incidentId) return;
    void client.openIncident(incidentId).catch((cause: unknown) => {
      if (!cancelled) setOpenError(clientErrorMessage(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  if (openError) {
    return (
      <div>
        <p role="alert" className="text-sm text-alert">
          {openError}
        </p>
        <BackLink />
      </div>
    );
  }

  // A revoked snapshot has no incident row. Check it before the id match, or the
  // lock screen is replaced by the opening state.
  if (state.me?.state === "revoked") {
    return (
      <div>
        <p className="font-mono text-[11px] tracking-[0.18em] text-alert">ACCESS</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">Your access to this incident was revoked.</h1>
        <BackLink />
      </div>
    );
  }

  if (state.connection === "error" && state.incident?.id !== incidentId) {
    return (
      <div>
        <p role="alert" className="text-sm text-alert">
          {state.error ?? "The incident client could not open this incident."}
        </p>
        <BackLink />
      </div>
    );
  }

  if (state.connection === "connecting" || state.incident?.id !== incidentId) {
    return <p className="text-sm text-muted">Opening the incident…</p>;
  }

  if (state.me?.state === "pending") return <Pending state={state} mock={mock} />;

  return <Room state={state} mock={mock} />;
}

function BackLink() {
  return (
    <Link
      href="/incidents"
      className="mt-6 inline-flex text-sm text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      Back to incidents
    </Link>
  );
}

function Pending({ state, mock }: { state: IncidentState; mock: boolean }) {
  const role = state.me ? ROLE_LABELS[state.me.role] : "Member";
  return (
    <div>
      <DemoBanner />
      <p className="mt-6 font-mono text-[11px] tracking-[0.18em] text-muted">WAITING</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Waiting for the commander.</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted">
        Your role is {role}. It came from the invite. The commander admits you into the room.
      </p>
      {state.me?.safetyCode ? (
        <p className="mt-4 font-mono text-sm text-foreground">
          Safety code {state.me.safetyCode}
          {mock ? ". Demo code. It was not derived from a key." : ""}
        </p>
      ) : null}
      <BackLink />
    </div>
  );
}

function Room({ state, mock }: { state: IncidentState; mock: boolean }) {
  const incident = state.incident;
  if (!incident) return <p className="text-sm text-muted">No incident is open in this tab.</p>;
  const awareness = (state.discovery?.determinedAt ?? incident.createdAt).toISOString();

  return (
    <div>
      <DemoBanner />
      <p className="mt-6 font-mono text-[11px] tracking-[0.18em] text-muted">
        {connectionLabel(state.connection, mock).toUpperCase()}
      </p>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-3xl tracking-tight sm:text-4xl">
            {incident.title || "Untitled incident"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {state.status ? (
              <span className="text-foreground">
                {state.status.severity} · {phaseLabel(state.status.phase)}
              </span>
            ) : (
              <span className="text-foreground">No status yet</span>
            )}
            {" · "}
            {formatTimestamp(incident.createdAt)}
          </p>
        </div>
        <IntegrityMark report={state.integrity} mock={mock} />
      </div>
      {state.status ? <p className="mt-4 max-w-3xl text-sm leading-6 text-muted">{state.status.summary}</p> : null}
      {state.connection === "offline" ? (
        <p className="mt-4 text-sm text-muted">The connection dropped. Showing the last update held in this tab.</p>
      ) : null}
      {state.connection === "error" && state.error ? (
        <p role="alert" className="mt-4 text-sm text-alert">
          {state.error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <HourClock startedAt={awareness} />
        <Panel id="members-heading" title="MEMBERS">
          <ul className="mt-4 space-y-3">
            {state.members.map((member) => (
              <li key={member.identity} className="text-sm">
                <span className="block text-foreground">
                  {member.displayName}
                  <span className="text-muted"> · {ROLE_LABELS[member.role]}</span>
                </span>
                <span className="mt-1 block font-mono text-[11px] text-muted" title={member.fingerprint}>
                  {memberStateLabel(member.state)} · {member.fingerprint}
                  {mock ? " · Demo fingerprint" : ""}
                </span>
                {member.verified ? (
                  <span className="mt-1 block text-xs text-verified">Admission certificate checked</span>
                ) : mock ? (
                  <span className="mt-1 block text-xs text-muted">Demo roster. Certificates are not checked.</span>
                ) : (
                  <span className="mt-1 block text-xs text-muted">Certificate not checked</span>
                )}
                {member.linkVerified === true ? (
                  <span className="mt-1 block text-xs text-muted">
                    {mock
                      ? "Demo token matched. This is not a cryptographic link check."
                      : "Link verified"}
                  </span>
                ) : null}
                {member.linkVerified === false ? (
                  <span className="mt-1 block text-xs text-alert">Unverified: do not admit</span>
                ) : null}
                {member.safetyCode ? (
                  <span className="mt-1 block font-mono text-[11px] text-muted">
                    Safety code {member.safetyCode}
                    {mock ? " · Demo code" : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <NoticeClocks incidentId={incident.id} awarenessAt={awareness} />

      <section className="mt-8" aria-labelledby="record-heading">
        <h2 id="record-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
          {CHANNEL_LABELS.record}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          #record is the structured event log. It is not a chat channel.
        </p>
        {state.timeline.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No timeline entries yet.</p>
        ) : (
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {state.timeline.map((item) => (
              <li key={item.entry.entryId} className="grid gap-2 py-4 sm:grid-cols-[11rem_1fr]">
                <div>
                  <p className="font-mono text-xs text-muted">{formatTimestamp(item.entry.occurredAt)}</p>
                  <p className="mt-1 text-sm text-foreground">
                    {phaseLabel(item.entry.phase)} · {item.entry.csf}
                  </p>
                </div>
                <div>
                  <p className="text-sm leading-6 text-foreground">
                    <SafeText text={item.entry.text} />
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {item.by?.displayName ?? "Unknown author"}
                    {item.sentAt ? ` · signed ${formatTimestamp(item.sentAt)}` : ""}
                    {` · server ${formatTimestamp(item.at)}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Panel id="channels-heading" title="CHANNELS">
          <ul className="mt-4 space-y-5">
            {state.channels.map((channel) => (
              <li key={channel.kind}>
                <p className="text-sm font-medium text-foreground">{CHANNEL_LABELS[channel.kind]}</p>
                {channel.kind === "privileged" ? (
                  <p className="mt-1 text-xs text-muted">Attorney-client privileged and confidential</p>
                ) : null}
                {channel.messages.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">No messages.</p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {channel.messages.map((message) => (
                      <li key={message.messageId} className="text-sm">
                        <p className="leading-6 text-foreground">
                          <SafeText text={message.text} />
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {message.author?.displayName ?? "Unknown author"} · {formatTimestamp(message.sentAt)}
                          {message.verdict.ok ? "" : " · Failed check"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="tasks-heading" title="TASKS">
          {state.tasks.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No tasks yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {state.tasks.map((task) => (
                <li key={task.taskId} className="text-sm">
                  <span className="block text-foreground">{task.latest.title}</span>
                  <span className="mt-1 block font-mono text-[11px] text-muted">
                    {taskStatusLabel(task.latest.status)} · {memberName(state.members, task.latest.assignee)}
                    {task.latest.dueAt ? ` · ${formatTimestamp(task.latest.dueAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="scope-heading" title="AFFECTED SYSTEMS">
          {state.scope.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No systems recorded yet.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {state.scope.map((item) => (
                <li key={item.itemId} className="text-sm">
                  <span className="block text-foreground">{item.latest.system}</span>
                  <span className="mt-1 block text-muted">
                    {scopeStatusLabel(item.latest.status)} · {assetLabel(item.latest.assetType)}
                    {item.latest.recordCount !== undefined
                      ? ` · ${item.latest.recordCount.toLocaleString("en-US")} records`
                      : ""}
                  </span>
                  {item.latest.dataTypes.length > 0 ? (
                    <span className="mt-1 block text-muted">
                      {item.latest.dataTypes.map((type) => dataTypeLabel(type)).join(" · ")}
                    </span>
                  ) : null}
                  {item.latest.affected.length > 0 ? (
                    <span className="mt-1 block text-muted">
                      {item.latest.affected
                        .map((row) => `${row.state} ${row.count.toLocaleString("en-US")}`)
                        .join(" · ")}
                    </span>
                  ) : null}
                  {item.latest.notes ? (
                    <p className="mt-2 leading-6 text-muted">
                      <SafeText text={item.latest.notes} />
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="evidence-heading" title="EVIDENCE">
          {state.evidence.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No evidence recorded yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {state.evidence.map((item) => (
                <li key={item.body.evidenceId} className="text-sm">
                  <span className="block text-foreground">{item.body.label}</span>
                  <span className="mt-1 block text-muted">
                    {item.body.custodian || "No custodian"}
                    {item.body.location ? ` · ${item.body.location}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
