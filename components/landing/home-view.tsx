import Link from "next/link";
import { Fingerprint, Radio, Scale, Users } from "lucide-react";
import { COUNSEL_REVIEW_WARNING, LEGAL_RULES } from "@/lib/legal";

const roles = [
  {
    index: "01",
    title: "Commander",
    copy: "Sets the sequence when the usual channels are no longer trusted.",
    icon: Radio,
  },
  {
    index: "02",
    title: "Counsel",
    copy: "Watches notice clocks. Privileged notes stay with the commander, counsel, and the executive.",
    icon: Scale,
  },
  {
    index: "03",
    title: "Technical",
    copy: "Holds the forensics work. The privileged channel stays closed to this seat.",
    icon: Fingerprint,
  },
  {
    index: "04",
    title: "Executive",
    copy: "Reads the record, command, and privileged channels. The technical channel stays closed.",
    icon: Users,
  },
];

function HeroGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -right-[22%] -top-[58%] h-[148%] w-[68%] rounded-full border-2 border-[#f6ffd4]"
        style={{
          boxShadow:
            "inset -30px 0 70px rgba(190,255,70,0.16), 0 0 6px 1px #f8ffd8, 0 0 20px 4px rgba(220,255,80,0.95), 0 0 48px 12px rgba(160,255,40,0.65), 0 0 110px 28px rgba(90,255,20,0.22)",
        }}
      />
      <div
        className="absolute -bottom-[62%] left-[-10%] h-[76%] w-[124%] rounded-[50%] border-2 border-[#f2ffb0]"
        style={{
          boxShadow:
            "0 0 8px 1px #f6ffd0, 0 0 22px 4px rgba(210,255,70,0.85), 0 0 60px 12px rgba(130,255,40,0.4)",
        }}
      />
    </div>
  );
}

export function HomeView() {
  return (
    <main id="content" className="flex flex-1 flex-col bg-black">
      <section className="relative -mt-20 min-h-svh overflow-hidden bg-black pt-20">
        <HeroGlow />
        <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-col px-5 pb-24 pt-8 sm:px-10 sm:pt-12 lg:px-14 lg:pt-14">
          <p className="flex items-center gap-3 text-[11px] font-medium tracking-[0.22em] text-[#d4d4d4] sm:text-xs">
            <span aria-hidden="true" className="h-0.5 w-7 shrink-0 bg-signal" />
            RANSOMWARE INCIDENT RESPONSE
          </p>
          <h1 className="mt-6 text-[clamp(1.35rem,5.5vw,4.65rem)] font-bold leading-[1.05] tracking-[-0.035em] text-white sm:leading-[1.02]">
            A secure war room
            <br />
            for <span className="text-signal">ransomware response.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#a3a3a3] sm:text-lg sm:leading-8">
            Coordinate, communicate, and make critical decisions in a secure, tamper-evident workspace.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/incidents"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-signal px-5 text-sm font-semibold text-signal-ink transition-colors hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Get Started
              <span aria-hidden="true">→</span>
            </Link>
            <a
              href="#learn"
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#3a3a3a] px-5 text-sm font-medium text-white transition-colors hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Learn More
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8">
        <section id="learn" aria-labelledby="roles-heading">
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
            {LEGAL_RULES.map((rule) => (
              <li key={rule.id} className="grid gap-2 py-4 sm:grid-cols-[14rem_1fr]">
                <div>
                  <p className="font-medium text-foreground">{rule.citation}</p>
                  <p className="mt-1 text-sm text-muted">{rule.jurisdiction}</p>
                  <a
                    href={rule.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="mt-1 inline-block break-all font-mono text-[11px] tracking-wide text-signal underline decoration-signal/40 underline-offset-2"
                  >
                    Source
                  </a>
                </div>
                <div>
                  <p className="text-sm leading-6 text-foreground">{rule.name}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{rule.appliesWhen}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{rule.trigger}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{rule.calculation}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-6 text-muted">
            CIRCIA covered-incident reporting is not in effect. The engine does not start a CIRCIA countdown. Notice
            duties outside the rules above, including other US states, are flagged for counsel and are not given a
            computed date.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">{COUNSEL_REVIEW_WARNING}</p>
        </section>

        <section className="mt-16" aria-labelledby="boundary-heading">
          <h2 id="boundary-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
            BOUNDARY
          </h2>
          <ol className="mt-4 grid gap-3 lg:grid-cols-3">
            <li className="rounded-2xl border border-line bg-panel-raised px-4 py-4">
              <p className="font-mono text-[11px] text-muted">01</p>
              <p className="mt-3 text-sm leading-6">
                Demo mode shows the Lakeside Family Clinic story in this tab. The live client feeds the same
                screens after the browser decrypts.
              </p>
            </li>
            <li className="rounded-2xl border border-line bg-panel-raised px-4 py-4">
              <p className="font-mono text-[11px] text-muted">02</p>
              <p className="mt-3 text-sm leading-6">Private keys stay on the device. Demo mode does not create keys.</p>
            </li>
            <li className="rounded-2xl border border-line bg-panel-raised px-4 py-4">
              <p className="font-mono text-[11px] text-muted">03</p>
              <p className="mt-3 text-sm leading-6">
                Incident pages read the client in the browser. The server is not asked to render incident contents.
              </p>
            </li>
          </ol>
        </section>
      </div>
    </main>
  );
}
