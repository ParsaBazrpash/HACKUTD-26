import Link from "next/link";
import { COUNSEL_REVIEW_WARNING, LEGAL_RULES } from "@/lib/legal";

const roles = [
  {
    index: "01",
    title: "Commander",
    copy: "Sets the sequence when the usual channels are no longer trusted.",
  },
  {
    index: "02",
    title: "Counsel",
    copy: "Watches notice clocks. Privileged notes stay with the commander, counsel, and the executive.",
  },
  {
    index: "03",
    title: "Technical",
    copy: "Holds the forensics work. The privileged channel stays closed to this seat.",
  },
  {
    index: "04",
    title: "Executive",
    copy: "Reads the record, command, and privileged channels. The technical channel stays closed.",
  },
];

const pillars = [
  {
    title: "Coordinate",
    copy: "Keep the right people in the room with role-based access.",
  },
  {
    title: "Decide",
    copy: "Turn findings into clear, recorded actions.",
  },
  {
    title: "Maintain evidence",
    copy: "Tamper-evident records from detection to resolution.",
  },
];

/** Decorative weight only. The window text is the planning aid. Shorter clocks read heavier. */
const CLOCK_GLANCE: Record<string, { label?: string; summary: string; window: string; fill: number }> = {
  "sec-8k-105": {
    label: "Form 8-K Item 1.05",
    summary: "SEC notice for material cybersecurity incidents.",
    window: "4 business days",
    fill: 50,
  },
  "hipaa-404": {
    summary: "HIPAA notice to affected individuals.",
    window: "60 days",
    fill: 34,
  },
  "hipaa-408": {
    summary: "HIPAA notice to HHS.",
    window: "60 days",
    fill: 30,
  },
  "hipaa-406": {
    summary: "HIPAA notice to prominent media.",
    window: "60 days",
    fill: 28,
  },
  "tx-521-ind": {
    summary: "Notice to affected Texas residents.",
    window: "60 days",
    fill: 32,
  },
  "tx-521-ag": {
    summary: "Notice to the Texas attorney general.",
    window: "30 days",
    fill: 40,
  },
};

const glanceRules = LEGAL_RULES.flatMap((rule) => {
  const glance = CLOCK_GLANCE[rule.id];
  return glance ? [{ rule, ...glance }] : [];
});

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

function BottomGlow() {
  return (
    <div aria-hidden="true" className="haven-reveal haven-slow pointer-events-none relative mt-10 h-40 sm:mt-16 sm:h-52">
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute -bottom-[155%] left-[-8%] h-[260%] w-[116%] rounded-[50%] border-2 border-[#f2ffb0]"
          style={{
            boxShadow:
              "0 0 8px 1px #f6ffd0, 0 0 22px 4px rgba(210,255,70,0.9), 0 0 64px 14px rgba(130,255,40,0.45)",
          }}
        />
      </div>
    </div>
  );
}

const stagger = ["", "haven-s1", "haven-s2", "haven-s3"] as const;

export function HomeView() {
  return (
    <main id="content" className="flex flex-1 flex-col bg-black">
      <section className="relative -mt-20 min-h-svh overflow-hidden bg-black pt-20">
        <HeroGlow />
        <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-col px-5 pb-28 pt-8 sm:px-10 sm:pt-14 lg:px-14 lg:pt-16">
          <p className="haven-rise flex items-center gap-3 text-[11px] font-medium tracking-[0.22em] text-[#d4d4d4] sm:text-xs">
            <span aria-hidden="true" className="h-0.5 w-7 shrink-0 bg-signal" />
            RANSOMWARE INCIDENT RESPONSE
          </p>
          <h1
            className="haven-rise mt-6 text-[clamp(2.15rem,5.2vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.035em] text-white sm:leading-[1.02]"
            style={{ animationDelay: "90ms" }}
          >
            A secure war room
            <br />
            for <span className="text-signal">ransomware response.</span>
          </h1>
          <p
            className="haven-rise mt-6 max-w-lg text-base leading-7 text-[#a3a3a3] sm:text-lg sm:leading-8"
            style={{ animationDelay: "180ms" }}
          >
            Coordinate, communicate, and make critical decisions in a secure, tamper-evident workspace.
          </p>
          <div className="haven-rise mt-8 flex flex-col gap-3 sm:flex-row sm:items-center" style={{ animationDelay: "280ms" }}>
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

      <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-10 lg:px-14">
        <section id="learn" className="scroll-mt-24 py-20 sm:py-28" aria-labelledby="roles-heading">
          <div className="haven-reveal">
            <p className="text-[11px] font-medium tracking-[0.22em] text-[#a3a3a3] sm:text-xs">WHO SHARES THE ROOM</p>
            <h2
              id="roles-heading"
              className="mt-4 max-w-3xl text-[clamp(1.75rem,3vw,2.6rem)] font-semibold tracking-[-0.03em] text-white"
            >
              A structured response, by role.
            </h2>
            <div aria-hidden="true" className="mt-8 h-px bg-white/10" />
          </div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {roles.map((role, index) => (
              <li key={role.index} className={`haven-reveal ${stagger[index]}`}>
                <div className="relative h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#070707] px-5 py-6">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_80%_at_100%_0%,rgba(190,255,70,0.22),transparent_55%)]"
                  />
                  <div className="relative">
                    <p className="font-mono text-[11px] tracking-wide text-[#8a8a8a]">{role.index}</p>
                    <h3 className="mt-6 text-lg font-semibold text-white">{role.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-[#9a9a9a]">{role.copy}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="py-8 sm:py-16" aria-labelledby="clocks-heading">
          <div className="haven-reveal haven-slow flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-medium tracking-[0.22em] text-[#a3a3a3] sm:text-xs">PUBLIC NOTICE CLOCKS</p>
              <h2
                id="clocks-heading"
                className="mt-4 max-w-3xl text-[clamp(1.75rem,3vw,2.6rem)] font-semibold tracking-[-0.03em] text-white"
              >
                Key regulatory obligations at a glance.
              </h2>
            </div>
            <p className="max-w-xs text-sm leading-6 text-[#8d8d8d] lg:pb-1 lg:text-right">
              Planning aids. Counsel confirms whether a duty applies.
            </p>
          </div>
          <ul className="mt-10 divide-y divide-white/10 border-y border-white/10">
            {glanceRules.map((row) => (
              <li key={row.rule.id} className="haven-reveal haven-slow grid gap-4 py-5 lg:grid-cols-[16rem_minmax(0,1fr)_11rem] lg:items-center lg:gap-8">
                <div>
                  <a
                    href={row.rule.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="font-medium text-white underline decoration-transparent underline-offset-4 transition-colors hover:decoration-signal/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    {row.label ?? row.rule.citation}
                  </a>
                  <p className="mt-1 text-sm text-[#8a8a8a]">{row.rule.jurisdiction}</p>
                </div>
                <p className="text-sm leading-6 text-[#b5b5b5]">{row.summary}</p>
                <div className="lg:text-right">
                  <p className="text-sm font-medium text-white">{row.window}</p>
                  <div className="mt-2 h-[2px] w-full bg-white/12" aria-hidden="true">
                    <div
                      className="h-[2px] bg-signal"
                      style={{
                        width: `${row.fill}%`,
                        boxShadow: row.fill > 0 ? "0 0 10px rgba(216,255,101,0.85)" : undefined,
                      }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="haven-reveal haven-slow mt-6 max-w-3xl space-y-2 text-sm leading-6 text-[#8d8d8d]">
            <p>
              A clock starts only from a recorded discovery or materiality time, and only when the incident profile
              brings that rule on. HIPAA notice to HHS is an annual log when fewer than 500 people are affected.
              Notice duties outside these rules, including other US states, are flagged for counsel and are not given
              a computed date.
            </p>
            <p>{COUNSEL_REVIEW_WARNING}</p>
          </div>
        </section>

        <section className="relative pb-4 pt-20 sm:pt-28" aria-labelledby="space-heading">
          <div className="haven-reveal haven-slow relative z-10">
            <p className="text-[11px] font-medium tracking-[0.22em] text-[#a3a3a3] sm:text-xs">BUILT FOR INCIDENT RESPONSE</p>
            <h2
              id="space-heading"
              className="mt-4 max-w-3xl text-[clamp(1.75rem,3vw,2.6rem)] font-semibold tracking-[-0.03em] text-white"
            >
              Everything in one secured space.
            </h2>
          </div>
          <ol className="relative z-10 mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {pillars.map((pillar, index) => (
              <li key={pillar.title} className={`haven-reveal haven-slow ${stagger[index]}`}>
                <h3 className="text-base font-semibold text-white">{pillar.title}</h3>
                <p className="mt-3 max-w-xs text-sm leading-6 text-[#9a9a9a]">{pillar.copy}</p>
              </li>
            ))}
          </ol>
          <p className="haven-reveal haven-slow relative z-10 mt-12 max-w-3xl text-sm leading-6 text-[#8d8d8d]">
            Demo mode shows the Lakeside Family Clinic story in this tab. Private keys stay on the device. Incident
            pages are read in the browser.
          </p>
        </section>
      </div>
      <BottomGlow />
    </main>
  );
}
