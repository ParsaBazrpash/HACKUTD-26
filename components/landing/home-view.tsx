import { Fingerprint, Radio, Scale, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { Main } from "@/components/shell/main";
import { describeClockStart, describeOffset, LEGAL_CATALOG } from "@/lib/legal";

const roles = [
  {
    index: "01",
    title: "Incident commander",
    copy: "Sets the sequence when the usual channels are no longer trusted.",
    icon: Radio,
  },
  {
    index: "02",
    title: "Legal counsel",
    copy: "Watches notice clocks and keeps counsel notes off the executive channel.",
    icon: Scale,
  },
  {
    index: "03",
    title: "Forensic investigator",
    copy: "Holds evidence descriptions in sealed slots, not in a shared inbox.",
    icon: Fingerprint,
  },
  {
    index: "04",
    title: "Executive",
    copy: "Sees the decisions the room is ready to share, and nothing else.",
    icon: Users,
  },
];

export function HomeView() {
  return (
    <Main>
      <section>
        <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.7fr)]">
          <div className="border-l border-line pl-5">
            <p className="font-mono text-[11px] tracking-[0.22em] text-muted">01 / RANSOMWARE RESPONSE</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-medium tracking-tight sm:text-6xl sm:leading-[1.05]">
              The first 72 hours, held in this browser.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
              ZeroHour is a war room for the window after a ransomware attack, when mail, chat,
              and the company directory may already belong to someone else.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/incidents">Open incidents</ButtonLink>
              <ButtonLink href="/join" variant="ghost">
                Join a room
              </ButtonLink>
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-panel px-5 py-5">
            <p className="font-mono text-[11px] tracking-[0.18em] text-muted">NOTICE WINDOW</p>
            <p className="mt-3 font-mono text-5xl tracking-tight text-signal">72:00:00</p>
            <p className="mt-3 text-sm leading-6 text-muted">
              From recorded awareness toward the first statutory clocks. The live countdown sits
              on an incident, not on this page.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-16" aria-labelledby="roles-heading">
        <h2 id="roles-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
          WHO SHARES THE ROOM
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {roles.map((role) => (
            <li key={role.index} className="rounded-2xl border border-line bg-panel px-4 py-4">
              <div className="flex items-center justify-between text-muted">
                <role.icon aria-hidden="true" className="size-4" />
                <span className="font-mono text-[11px]">{role.index}</span>
              </div>
              <h3 className="mt-4 text-base font-medium">{role.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{role.copy}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16" aria-labelledby="clocks-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="clocks-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
            PUBLIC NOTICE CLOCKS
          </h2>
          <p className="text-sm text-muted">Planning aids. Counsel confirms whether a duty applies.</p>
        </div>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {LEGAL_CATALOG.map((entry) => (
            <li key={entry.id} className="grid gap-2 py-4 sm:grid-cols-[14rem_1fr]">
              <div>
                <p className="font-medium text-foreground">{entry.citation}</p>
                <p className="mt-1 font-mono text-[11px] tracking-wide text-muted">
                  {describeOffset(entry.offset)} from {describeClockStart(entry.clockStarts)}
                </p>
              </div>
              <p className="text-sm leading-6 text-muted">{entry.obligation}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16" aria-labelledby="boundary-heading">
        <h2 id="boundary-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
          BOUNDARY
        </h2>
        <ol className="mt-4 grid gap-3 lg:grid-cols-3">
          <li className="rounded-2xl border border-line bg-panel-raised px-4 py-4">
            <p className="font-mono text-[11px] text-muted">01</p>
            <p className="mt-3 text-sm leading-6">
              Narratives, messages, and asset details are not stored. The data client accepts sealed shells only.
            </p>
          </li>
          <li className="rounded-2xl border border-line bg-panel-raised px-4 py-4">
            <p className="font-mono text-[11px] text-muted">02</p>
            <p className="mt-3 text-sm leading-6">
              Private keys and channel keys never enter source, logs, or the server.
            </p>
          </li>
          <li className="rounded-2xl border border-line bg-panel-raised px-4 py-4">
            <p className="font-mono text-[11px] text-muted">03</p>
            <p className="mt-3 text-sm leading-6">
              This build does not encrypt. A fixture slot is a label, not ciphertext, and integrity stays unknown.
            </p>
          </li>
        </ol>
      </section>
    </Main>
  );
}
