import type { ReactNode } from "react";
import {
  Calendar,
  CircleAlert,
  CircleCheck,
  Clock,
  GitBranch,
  Hash,
  Layers,
  Search,
  User,
  Users,
  Zap,
} from "lucide-react";
import type { PageView } from "@/lib/client/types";
import type { IncidentReport, ReportDeadline, ReportMember } from "@/lib/report/build";
import {
  commanderName,
  coverActions,
  coverDecisions,
  executiveBullets,
  incidentStanding,
  integrityLabel,
  phaseSteps,
  coverStats,
  severityTone,
  type CoverAction,
} from "@/lib/report/sheet";
import { cardPreviewText } from "@/components/incidents/blast-radius-model";
import { SafeText } from "@/components/incidents/safe-text";

const ink = "text-[#1c1f1c]";
const muted = "text-[#8b938c]";
const green = "text-[#3c9448]";
const card = "print-keep rounded-2xl border border-[#e1e6df] bg-white p-4";
const chip = "flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#e5f6dc] text-[#3c9448]";

export function ReportSheet({
  report,
  pages,
  commander,
}: {
  report: IncidentReport;
  pages: readonly PageView[];
  commander: string | null;
}) {
  const standing = incidentStanding(report.phase);
  const lead = commanderName(report, commander);
  const integrity = integrityLabel(report);
  const actions = coverActions(report, pages, lead === "Not recorded" ? "Commander" : lead);
  const decisions = coverDecisions(report);
  const bullets = executiveBullets(report);
  const steps = phaseSteps(report);
  const stats = coverStats(report);
  const tone = severityTone(report.severity);

  return (
    <article
      id="incident-report"
      className={`report-sheet mx-auto mt-8 w-full min-w-[760px] max-w-[820px] bg-white px-8 py-8 text-[13px] leading-6 ${ink} shadow-[0_16px_50px_rgba(0,0,0,0.28)] print:mt-0 print:min-w-0 print:max-w-none print:bg-white print:px-0 print:py-0 print:shadow-none [&_a]:!text-[#1d6b3c] [&_a]:underline`}
      style={{ colorScheme: "light" }}
    >
      {report.privileged.watermark ? (
        <div className="privileged-watermark" aria-hidden="true">
          <span>{report.privileged.watermark}</span>
        </div>
      ) : null}

      <div className="report-cover">
        <section className="report-hero" aria-label="Incident overview">
          <header className="flex items-center justify-between gap-6">
            <HavenLogo tone="dark" />
            <p className="rounded-full border border-white/25 px-3 py-1 text-[10px] font-semibold tracking-[0.2em] text-[#bfe9ae]">
              CONFIDENTIAL · INCIDENT RESPONSE REPORT
            </p>
          </header>

          <div className="mt-6 flex items-end justify-between gap-6">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.24em] text-[#7fdc5a]">INCIDENT RESPONSE REPORT</p>
              <h2 className="mt-2 break-words text-[34px] font-extrabold leading-[1.05] tracking-tight text-white">
                <SafeText text={report.title} />
              </h2>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <span className={`severity-pill severity-${tone}`}>{report.severity}</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium text-white">
                <span aria-hidden="true" className={`size-2 rounded-full ${standing === "Open" ? "bg-[#4be06a]" : "bg-[#9aa39c]"}`} />
                {standing}
              </span>
            </div>
          </div>

          <ol className="mt-6 grid grid-cols-6 gap-1.5" aria-label="Response phase">
            {steps.map((step, index) => (
              <li key={step.label} className={`phase-step phase-${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
                <span className="phase-bar" aria-hidden="true" />
                <span className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.06em]">
                  <span className="phase-num">{index + 1}</span>
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="report-stats relative z-10 -mt-6 grid grid-cols-4 gap-3 px-4">
          {stats.map((stat) => (
            <div key={stat.label} className="print-keep rounded-2xl border border-[#e1e6df] bg-white px-4 py-3 shadow-[0_6px_18px_rgba(18,40,24,0.10)]">
              <p className={`text-[9.5px] font-semibold tracking-[0.14em] ${muted}`}>{stat.label.toUpperCase()}</p>
              <p className="mt-1 text-[26px] font-extrabold leading-none tracking-tight text-[#14201a]">{stat.value}</p>
              <p className={`mt-1.5 text-[11px] leading-4 ${muted}`}>{stat.sub}</p>
            </div>
          ))}
        </div>

        <dl className="mt-4 grid grid-cols-4 divide-x divide-[#e7eae6] rounded-2xl border border-[#e7eae6] bg-[#fafbf9]">
          <Meta icon={<Hash className="size-3.5" aria-hidden="true" />} label="Incident ID" value={report.incidentId} mono />
          <Meta icon={<User className="size-3.5" aria-hidden="true" />} label="Commander" value={lead} />
          <Meta
            icon={<Calendar className="size-3.5" aria-hidden="true" />}
            label="Exported"
            value={report.exportedAt ?? "Opens with the browser clock."}
          />
          <Meta
            icon={
              integrity.ok ? (
                <CircleCheck className={`size-3.5 ${green}`} aria-hidden="true" />
              ) : (
                <CircleAlert className="size-3.5 text-[#a33b32]" aria-hidden="true" />
              )
            }
            label="Integrity"
            value={integrity.label}
            tone={integrity.ok ? "good" : "bad"}
          />
        </dl>

        {report.connectionNote ? <p className={`mt-3 text-[12px] ${muted}`}>{report.connectionNote}</p> : null}

        <section className="mt-4 rounded-2xl border border-[#cfe9c4] bg-gradient-to-br from-[#eaf8e3] to-[#f6fcf2] px-5 py-4" aria-labelledby="report-executive-summary">
          <h3 id="report-executive-summary" className={`flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] ${green}`}>
            <Zap className="size-4" aria-hidden="true" />
            EXECUTIVE SUMMARY
          </h3>
          <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[13px] leading-5 text-[#243028]">
            {bullets.map((bullet, index) => (
              <li key={index}>
                <SafeText text={bullet} />
              </li>
            ))}
          </ul>
          {report.demoNote ? <p className="mt-2 text-[11px] leading-4 text-[#5c6560]">{report.demoNote}</p> : null}
        </section>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <section className={`${card} col-span-2`} aria-labelledby="report-discovery">
            <CardTitle id="report-discovery" icon={<Search className="size-[18px]" aria-hidden="true" />} title="Discovery & Materiality" />
            <div className="mt-3 grid grid-cols-2 gap-6">
              <Fact label="Discovery" determination={report.discovery} />
              <Fact label="Materiality" determination={report.materiality} />
            </div>
          </section>

          <section className={card} aria-labelledby="report-decisions">
            <CardTitle id="report-decisions" icon={<GitBranch className="size-[18px]" aria-hidden="true" />} title="Key Decisions" />
            {decisions.length === 0 ? (
              <p className={`mt-3 text-[12.5px] ${muted}`}>No decisions recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {decisions.map((decision) => (
                  <li key={decision.id} className="print-keep rounded-xl border-l-[3px] border-[#3c9a4a] bg-[#f4f6f3] px-3 py-2">
                    <p className="text-[12.5px] font-semibold leading-5 text-[#1c1f1c]">
                      <SafeText text={decision.title} />
                    </p>
                    <p className={`mt-0.5 text-[11px] ${muted}`}>{decision.meta}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-labelledby="report-systems">
            <CardTitle id="report-systems" icon={<Layers className="size-[18px]" aria-hidden="true" />} title="Affected Systems" />
            {report.systems.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-[#3a403c]">{report.systemsEmpty ?? "No affected systems are on the record."}</p>
            ) : (
              <ul className="mt-2 divide-y divide-[#eef0ee]">
                {report.systems.map((system) => (
                  <li key={system.id} className="print-keep flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 break-words text-[12.5px] font-medium">
                      <SafeText text={system.name} />
                    </span>
                    <span className={`system-chip system-${system.status.toLowerCase()}`}>{system.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${card} col-span-2`} aria-labelledby="report-people">
            <CardTitle id="report-people" icon={<Users className="size-[18px]" aria-hidden="true" />} title="People Involved" />
            {report.roster.length === 0 ? (
              <p className={`mt-3 ${muted}`}>{report.rosterEmpty ?? "No team roles are on the record."}</p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {report.roster.map((member) => (
                  <Person key={`${member.name}-${member.fingerprint}`} member={member} />
                ))}
              </ul>
            )}
          </section>
        </div>

      </div>

      <TimelineAppendix report={report} actions={actions} />
      <RecordAppendix report={report} />

      <footer className="report-cover-footer mt-8 flex items-center justify-between gap-4 border-t border-[#e7eae6] pt-3 text-[11px] text-[#9aa19c]">
          <p>Generated by HAVEN · {report.exportedAt ?? "Export time opens with the browser clock."} · All times UTC</p>
          <p>Haven incident record</p>
        </footer>

    </article>
  );
}

function TimelineAppendix({ report, actions }: { report: IncidentReport; actions: CoverAction[] }) {
  return (
    <div className="report-timeline-page mt-8 print:mt-0">
      <h2 className="flex items-center gap-2.5 text-[20px] font-extrabold tracking-tight text-[#14201a]">
        <span className={chip}>
          <Clock className="size-[18px]" aria-hidden="true" />
        </span>
        Timeline of actions
      </h2>
      <p className={`mt-1 text-[12px] ${muted}`}>Every signed entry, oldest first. Times are UTC.</p>
      {actions.length === 0 ? (
        <p className={`mt-3 ${muted}`}>{report.timelineEmpty ?? "No timeline entries are on the record."}</p>
      ) : (
        <ol className="relative ml-2 mt-5 space-y-3.5 border-l-2 border-[#cfe6c8] pl-5">
          {actions.map((action) => (
            <li key={action.id} className="print-keep relative">
              <span aria-hidden="true" className="absolute -left-[27px] top-1.5 size-3 rounded-full bg-[#3c9a4a] ring-4 ring-white" />
              <p>
                <span className="inline-flex rounded-full bg-[#eef3ec] px-2.5 py-0.5 text-[11.5px] font-medium text-[#41594a]">{action.when}</span>
              </p>
              <p className="mt-1 text-[13px] font-semibold text-[#1c1f1c]">
                <SafeText text={action.title} />
              </p>
              {action.detail ? (
                <p className="text-[12.5px] text-[#243028]">
                  <SafeText text={action.detail} />
                </p>
              ) : null}
              <p className={`text-[11.5px] ${muted}`}>{action.signature}</p>
              {action.note ? <p className={`text-[11.5px] ${muted}`}>{action.note}</p> : null}
              {action.alert ? <p className="text-[11.5px] text-[#a33b32]">{action.alert}</p> : null}
            </li>
          ))}
        </ol>
      )}

      {report.systems.length > 0 ? (
        <section className="mt-8" aria-labelledby="report-systems-detail">
          <h2 id="report-systems-detail" className="flex items-center gap-2.5 text-[20px] font-extrabold tracking-tight text-[#14201a]">
            <span className={chip}>
              <Layers className="size-[18px]" aria-hidden="true" />
            </span>
            Affected systems in detail
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3">
            {report.systems.map((system) => (
              <li key={system.id} className={card}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">
                    <SafeText text={system.name} />
                  </p>
                  <span className={`system-chip system-${system.status.toLowerCase()}`}>{system.status}</span>
                </div>
                <p className={muted}>{system.asset}</p>
                <p className="mt-1">{system.data}</p>
                <p className={muted}>Records {system.records}</p>
                <p className={muted}>{system.residents}</p>
                {system.euResidents ? <p className={muted}>EU residents {system.euResidents}</p> : null}
                {system.notes ? (
                  <p className="mt-1">
                    <SafeText text={system.notes} />
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function RecordAppendix({ report }: { report: IncidentReport }) {
  return (
    <div className="report-appendix mt-10 border-t border-[#e7eae6] pt-8 print:mt-0 print:border-0 print:pt-0">
      <header className="flex items-center justify-between gap-6">
        <HavenLogo tone="light" />
        <p className={`text-[11px] font-medium tracking-[0.16em] ${muted}`}>SUPPORTING RECORD</p>
      </header>
      <h2 className="mt-6 text-[22px] font-bold tracking-tight">Evidence, deadlines, and verification</h2>
      <p className={`mt-2 max-w-xl text-[13px] ${muted}`}>
        The cover is the incident as it stands. This record keeps the evidence hashes, notice clocks, tasks, roster, and the check of the hash chain.
      </p>

      <div className="mt-6 grid gap-4">
        <section className={card} aria-labelledby="report-evidence">
          <h3 id="report-evidence" className="text-[15px] font-semibold">
            Evidence
          </h3>
          {report.evidence.length === 0 ? (
            <p className={`mt-3 ${muted}`}>{report.evidenceEmpty ?? "No evidence records are on the record."}</p>
          ) : (
            <div className="mt-3 grid gap-3">
              {report.evidence.map((item) => (
                <article key={item.id} className="print-keep border-t border-[#e7eae6] pt-3">
                  <h4 className="font-semibold">
                    <SafeText text={item.label} />
                  </h4>
                  <p className={muted}>SHA-256</p>
                  <p className="break-all font-mono text-[12px]">{item.sha256}</p>
                  <p className={muted}>
                    <SafeText text={item.custodian} />
                    {" · "}
                    <SafeText text={item.location} />
                    {` · ${item.recordedAt}`}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className={card} aria-labelledby="report-deadlines">
          <h3 id="report-deadlines" className="text-[15px] font-semibold">
            Legal deadlines
          </h3>
          <p className="mt-3">{report.disclaimer}</p>
          <p className={`mt-2 ${muted}`}>{report.counselWarning}</p>
          {report.deadlinesEmpty ? <p className={`mt-3 ${muted}`}>{report.deadlinesEmpty}</p> : null}
          {report.deadlines && report.deadlines.length > 0 ? (
            <div className="mt-4 grid gap-4">
              {report.deadlines.map((deadline) => (
                <DeadlineBlock key={deadline.id} deadline={deadline} />
              ))}
            </div>
          ) : null}
        </section>

        <section className={card} aria-labelledby="report-tasks">
          <h3 id="report-tasks" className="text-[15px] font-semibold">
            Response tasks
          </h3>
          {report.tasks.length === 0 ? (
            <p className={`mt-3 ${muted}`}>{report.tasksEmpty ?? "No response tasks are on the record."}</p>
          ) : (
            <ul className="mt-3 divide-y divide-[#e7eae6] border-y border-[#e7eae6]">
              {report.tasks.map((task) => (
                <li key={task.id} className="print-keep py-3">
                  <p>
                    <SafeText text={task.title} />
                  </p>
                  <p className={muted}>
                    {task.status} · {task.owner} · {task.due}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-labelledby="report-roster-detail">
          <h3 id="report-roster-detail" className="text-[15px] font-semibold">
            Roster
          </h3>
          {report.roster.length === 0 ? (
            <p className={`mt-3 ${muted}`}>{report.rosterEmpty ?? "No team roles are on the record."}</p>
          ) : (
            <ul className="mt-3 divide-y divide-[#e7eae6] border-y border-[#e7eae6]">
              {report.roster.map((member) => (
                <li key={`${member.fingerprint}-${member.name}`} className="print-keep py-3">
                  <p>
                    <SafeText text={member.name} /> · {member.role} · {member.state}
                  </p>
                  <p className={`break-all font-mono text-[12px] ${muted}`}>{member.fingerprint}</p>
                  <p className={`text-[12px] ${muted}`}>
                    Joined {member.joinedAt} · Admitted {member.admittedAt}
                    {member.revokedAt ? ` · Revoked ${member.revokedAt}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-labelledby="report-integrity-detail">
          <h3 id="report-integrity-detail" className="text-[15px] font-semibold">
            Integrity verification
          </h3>
          <p className="mt-3">{report.integrity.summary}</p>
          <p className={`mt-2 ${muted}`}>Checked {report.integrity.checkedAt}</p>
          <p className="mt-2 break-all">Commander fingerprint {report.integrity.commanderFingerprint}</p>
          <p className={`mt-1 break-all ${muted}`}>{report.integrity.build}</p>
          {report.integrity.rosterFailures.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {report.integrity.rosterFailures.map((failure) => (
                <li key={failure} className="break-all text-[#a33b32]">
                  {failure}
                </li>
              ))}
            </ul>
          ) : (
            <p className={`mt-3 ${muted}`}>No roster failures are on this check.</p>
          )}
          {report.integrity.channels.length === 0 ? (
            <p className={`mt-3 ${muted}`}>No channel head is available to this client.</p>
          ) : (
            <div className="mt-4 grid gap-4">
              {report.integrity.channels.map((channel) => (
                <article key={channel.channel} className="print-keep border-t border-[#e7eae6] pt-3">
                  <h4 className="font-semibold">
                    {channel.channel} · {channel.result}
                  </h4>
                  <p className={muted}>{channel.eventsChecked} events checked</p>
                  <p className="break-all">{channel.head}</p>
                  <p className={muted}>{channel.pinned}</p>
                  <p>{channel.checkpoint}</p>
                  {channel.failures.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {channel.failures.map((failure) => (
                        <li key={failure} className="text-[#a33b32]">
                          {failure}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className={card} aria-labelledby="report-privileged">
          <h3 id="report-privileged" className="text-[15px] font-semibold">
            Privileged communications
          </h3>
          {report.privileged.included ? (
            <p className={`mt-3 border border-[#3c9448] px-3 py-2 font-medium ${green}`}>PRIVILEGED / CONFIDENTIAL</p>
          ) : null}
          <p className={report.privileged.included ? "mt-3" : "mt-3"}>{report.privileged.note}</p>
          {report.privileged.included && report.privileged.messages.length === 0 ? (
            <p className={`mt-3 ${muted}`}>The privileged channel has no messages to include.</p>
          ) : null}
          {report.privileged.included && report.privileged.messages.length > 0 ? (
            <ol className="mt-3 divide-y divide-[#e7eae6] border-y border-[#e7eae6]">
              {report.privileged.messages.map((message, index) => (
                <li key={`${message.at}-${index}`} className="py-3">
                  <p>
                    <SafeText text={cardPreviewText(message.text)} />
                  </p>
                  <p className={`text-[12px] ${muted}`}>
                    {message.author} · {message.at}
                  </p>
                  {message.verdict ? <p className="text-[12px] text-[#a33b32]">{message.verdict}</p> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function HavenLogo({ tone }: { tone: "dark" | "light" }) {
  const word = tone === "dark" ? "text-white" : "text-[#0a0c0b]";
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-9 w-11 items-center justify-center rounded-lg ${tone === "dark" ? "" : "bg-[#080a09]"}`}>
        <svg viewBox="0 0 40 24" className="h-5 w-9" aria-hidden="true" fill="none">
          <path d="M5 17 L20 6 L35 17" stroke="#d8ff65" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className={`text-[17px] font-semibold tracking-[0.42em] ${word}`}>HAVEN</span>
    </div>
  );
}

function CardTitle({ id, icon, title }: { id: string; icon: ReactNode; title: string }) {
  return (
    <h3 id={id} className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-[#1a1c1a]">
      <span className={chip}>{icon}</span>
      {title}
    </h3>
  );
}

function Meta({
  icon,
  label,
  value,
  mono,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  tone?: "good" | "bad";
}) {
  const valueClass =
    tone === "good" ? "font-medium text-[#2f8a3e]" : tone === "bad" ? "font-medium text-[#a33b32]" : "text-[#1c1f1c]";
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className={`flex items-center gap-1.5 text-[10px] font-medium tracking-[0.14em] ${muted}`}>
        {icon}
        {label.toUpperCase()}
      </dt>
      <dd className={`mt-1 text-[13px] leading-5 ${mono ? "break-all font-mono text-[12px]" : "break-words"} ${valueClass}`}>{value}</dd>
    </div>
  );
}

function Fact({ label, determination }: { label: string; determination: IncidentReport["discovery"] }) {
  return (
    <div className="min-w-0">
      <p className={`text-[10px] font-medium tracking-[0.14em] ${muted}`}>{label.toUpperCase()}</p>
      {determination.recorded ? (
        <>
          <p className="mt-1 text-[13px] leading-5 text-[#1c1f1c]">
            <SafeText text={determination.basis} />
          </p>
          <p className={`mt-1 text-[12px] ${muted}`}>
            {determination.at} · {determination.by}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[13px] text-[#3a403c]">Not recorded</p>
      )}
    </div>
  );
}

function Person({ member }: { member: ReportMember }) {
  const live = member.state === "Active";
  const label = live ? member.role : member.state;
  return (
    <li className="print-keep flex items-center gap-2.5 rounded-full border border-[#e4e7e3] bg-[#fafbf9] py-1 pl-3 pr-1">
      <span className="min-w-0 break-words text-[12.5px] font-medium text-[#1c1f1c]">
        <SafeText text={member.name} />
      </span>
      <span
        className={
          live
            ? "shrink-0 rounded-full border border-[#c6e7bc] px-2.5 py-0.5 text-[12px] font-medium text-[#2f8a3e]"
            : "shrink-0 rounded-full border border-[#e4e7e3] px-2.5 py-0.5 text-[12px] font-medium text-[#8b938c]"
        }
      >
        {label}
      </span>
    </li>
  );
}

function DeadlineBlock({ deadline }: { deadline: ReportDeadline }) {
  return (
    <article className="print-keep border-t border-[#e7eae6] pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">{deadline.name}</h4>
        {deadline.urgent ? <p className={`text-[12px] font-medium ${green}`}>Most urgent</p> : null}
      </div>
      <p className={muted}>{deadline.jurisdiction}</p>
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
          <a href={deadline.sourceUrl} rel="noopener noreferrer">
            {deadline.sourceUrl}
          </a>
        </p>
      ) : (
        <p className={`mt-2 ${muted}`}>No official link is recorded for this rule.</p>
      )}
      <p className={`mt-2 ${muted}`}>
        <SafeText text={deadline.explanation} />
      </p>
      {deadline.recorded ? (
        <p className="mt-2">
          <SafeText text={deadline.recorded} />
        </p>
      ) : null}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2">
      <dt className={muted}>{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
