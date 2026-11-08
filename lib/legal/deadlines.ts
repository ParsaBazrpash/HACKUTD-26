import type { DeadlineUpdate, IncidentState } from "@/lib/client/types";
import { EMPTY_PROFILE } from "@/lib/client/types";
import {
  CIVIL_ZONE,
  OPM_HOLIDAY_URL,
  SEC_FILING_HOUR,
  SEC_FILING_MINUTE,
  SEC_ZONE,
  addBusinessDays,
  addIsoDays,
  civilDate,
  endOfNthCalendarDay,
  zonedWallTime,
} from "@/lib/legal/calendar";
import {
  COUNSEL_REVIEW_WARNING,
  type Applicability,
  type ClockStatus,
  type ComputedDeadline,
  type LegalRule,
  type RecordedDeadline,
} from "@/lib/legal/types";

/**
 * Incident-response deadline engine (docs/PLAN.md section 8).
 *
 * Reads only `IncidentState`. Profile flags and scope facts decide whether a
 * rule is on this incident. A countdown starts only from `legal.discovery` or
 * `legal.materiality`. Timeline text is never parsed into a trigger.
 *
 * Scope is the Winstead brief: a Texas organization. The catalog is the Texas
 * breach statute, the HIPAA breach rules, SEC Item 1.05 for a public company,
 * and a counsel flag for residents of any other state (California's 30-day
 * rule is named but not started, because its statutory delays need counsel).
 */

const SEC_FORM_URL = "https://www.sec.gov/files/form8-k.pdf";
const HIPAA_404_URL = "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.404";
const HIPAA_406_URL = "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.406";
const HIPAA_408_URL = "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.408";
const HHS_RANSOMWARE_URL =
  "https://www.hhs.gov/hipaa/for-professionals/security/guidance/cybersecurity/ransomware-fact-sheet/index.html";
const TEXAS_URL = "https://statutes.capitol.texas.gov/Docs/BC/htm/BC.521.htm";
const CALIFORNIA_URL =
  "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82.";

const DUE_SOON_MS = 6 * 3_600_000;
const OPEN = new Set(["suspected", "exfiltrated"]);
const HIPAA_OPEN = new Set(["suspected", "exfiltrated", "encrypted"]);
const CLOSED = new Set(["contained", "eradicated", "restored"]);
const PERSONAL = new Set([
  "ssn",
  "drivers_license",
  "financial_account",
  "payment_card",
  "phi",
  "credentials",
  "biometric",
  "employee_hr",
  "other_pii",
]);
const SPI = new Set(["ssn", "drivers_license", "financial_account", "payment_card", "phi"]);
const RUNNING: ReadonlySet<ClockStatus> = new Set(["scheduled", "due_soon", "elapsed"]);

const SEC_RULE: LegalRule = {
  id: "sec-8k-105",
  name: "SEC Form 8-K Item 1.05",
  jurisdiction: "United States",
  citation: "Form 8-K Item 1.05, General Instruction B.1",
  sourceUrl: SEC_FORM_URL,
  appliesWhen: "The profile marks a public company.",
  trigger: "legal.materiality. The registrant's determination that the incident is material. Discovery does not start this clock.",
  calculation:
    "Four business days after the materiality determination, in America/New_York. The determination date is not counted. Saturdays, Sundays, and the OPM federal holidays for 2026 and 2027 are skipped. Due at 5:30 p.m. Eastern, the last time an EDGAR filing still counts as that business day (17 CFR 232.13(a)(2)).",
  timeZone: SEC_ZONE,
};

const HIPAA_404_RULE: LegalRule = {
  id: "hipaa-404",
  name: "HIPAA notice to individuals",
  jurisdiction: "United States",
  citation: "45 CFR 164.404",
  sourceUrl: HIPAA_404_URL,
  appliesWhen: "The profile marks a HIPAA covered entity, and PHI is suspected, exfiltrated, or encrypted.",
  trigger: "legal.discovery. Discovery of the breach.",
  calculation: "60 calendar days after the discovery civil date in America/Chicago, through the end of that day.",
  timeZone: CIVIL_ZONE,
};

const HIPAA_408_RULE: LegalRule = {
  id: "hipaa-408",
  name: "HIPAA notice to HHS",
  jurisdiction: "United States",
  citation: "45 CFR 164.408",
  sourceUrl: HIPAA_408_URL,
  appliesWhen: "A HIPAA breach is on the record and the PHI count is 500 or more. Under 500, the duty is an annual log and this engine does not start a countdown.",
  trigger: "legal.discovery.",
  calculation: "For 500 or more individuals, the same 60 calendar days as individual notice. Under 500, 60 days after the end of the calendar year, flagged for counsel.",
  timeZone: CIVIL_ZONE,
};

const HIPAA_406_RULE: LegalRule = {
  id: "hipaa-406",
  name: "HIPAA media notice",
  jurisdiction: "United States",
  citation: "45 CFR 164.406",
  sourceUrl: HIPAA_406_URL,
  appliesWhen: "A HIPAA breach affects more than 500 residents of one state or jurisdiction. 500 exactly does not qualify.",
  trigger: "legal.discovery.",
  calculation: "60 calendar days after the discovery civil date in America/Chicago, through the end of that day.",
  timeZone: CIVIL_ZONE,
};

const TEXAS_INDIVIDUAL_RULE: LegalRule = {
  id: "tx-521-ind",
  name: "Texas notice to individuals",
  jurisdiction: "Texas",
  citation: "Tex. Bus. & Com. Code 521.053(b)",
  sourceUrl: TEXAS_URL,
  appliesWhen: "Sensitive personal information of at least one Texas resident is suspected or exfiltrated.",
  trigger: "legal.discovery, used as the date the person determines the breach occurred.",
  calculation: "The 60th calendar day after that date, through the end of the day in America/Chicago.",
  timeZone: CIVIL_ZONE,
};

const TEXAS_AG_RULE: LegalRule = {
  id: "tx-521-ag",
  name: "Texas notice to the attorney general",
  jurisdiction: "Texas",
  citation: "Tex. Bus. & Com. Code 521.053(i)",
  sourceUrl: TEXAS_URL,
  appliesWhen: "The breach involves at least 250 Texas residents. 249 does not qualify.",
  trigger: "legal.discovery, used as the date the person determines the breach occurred.",
  calculation: "The 30th calendar day after that date, through the end of the day in America/Chicago.",
  timeZone: CIVIL_ZONE,
};

export const LEGAL_RULES: readonly LegalRule[] = [
  SEC_RULE,
  HIPAA_404_RULE,
  HIPAA_408_RULE,
  HIPAA_406_RULE,
  TEXAS_INDIVIDUAL_RULE,
  TEXAS_AG_RULE,
];

const SEC_NOTE =
  "Item 1.05 is the registrant's materiality determination. A Department of Justice delay applies only when the Attorney General notifies the Commission in writing before the Form 8-K would be due. This engine does not apply that delay.";
const HIPAA_NOTE = `45 CFR 164.404 covers a breach of unsecured PHI. HHS ransomware guidance treats ransomware encryption of ePHI as a presumed breach unless a low probability of compromise is documented (${HHS_RANSOMWARE_URL}). A law-enforcement delay under 45 CFR 164.412 is not applied here.`;
const TEXAS_NOTE =
  "Sensitive personal information is defined in section 521.002. The record stores data categories, not the statutory name-plus-element combination. Encrypted data is a breach under section 521.053(a) only when the actor has the key. A law-enforcement delay is not applied here.";
const STATE_NOTE =
  "State breach statutes differ in who must notify, what data counts, and whether any day count exists. This engine computes Texas and flags every other state for counsel.";

type DueKind = "days-60" | "days-30" | "sec-4";
type TriggerKind = "discovery" | "materiality";

interface Decision {
  applicability: Applicability;
  due: DueKind | null;
  explanation: string;
  counselNote: string;
}

interface Exposure {
  scopeEmpty: boolean;
  unresolved: boolean;
  personalOpen: boolean;
  personalEncrypted: boolean;
  personalClosed: boolean;
  phiOpen: boolean;
  phiClosed: boolean;
  phiUnresolved: boolean;
  phiRecords: number;
  phiRecordsIncomplete: boolean;
  phiStates: Map<string, number>;
  phiStatesIncomplete: boolean;
  spiOpen: boolean;
  spiEncrypted: boolean;
  spiClosed: boolean;
  texasCount: number;
  texasIncomplete: boolean;
  stateCounts: Map<string, number>;
  encryptedStates: Set<string>;
  stateIncomplete: boolean;
}

interface DueResult {
  dueAt: Date;
  detail: string;
}

export function computeDeadlines(state: IncidentState, now: Date): ComputedDeadline[] {
  const clock = now instanceof Date && Number.isFinite(now.getTime()) ? now : null;
  const profile = state.profile ?? EMPTY_PROFILE;
  const exposure = readExposure(state);
  const rows = [
    finish(state, clock, SEC_RULE, sec(profile), "materiality"),
    finish(state, clock, HIPAA_404_RULE, hipaaIndividuals(profile, exposure), "discovery"),
    finish(state, clock, HIPAA_408_RULE, hipaaSecretary(state, profile, exposure), "discovery"),
    finish(state, clock, HIPAA_406_RULE, hipaaMedia(profile, exposure), "discovery"),
    finish(state, clock, TEXAS_INDIVIDUAL_RULE, texasIndividuals(exposure), "discovery"),
    finish(state, clock, TEXAS_AG_RULE, texasAttorneyGeneral(exposure), "discovery"),
    ...stateNotices(state, exposure),
  ];
  const known = new Set(rows.map((row) => row.rule.id));
  for (const update of Object.values(state.deadlineUpdates ?? {})) {
    const ruleId = update?.body?.ruleId;
    if (typeof ruleId !== "string" || known.has(ruleId)) continue;
    rows.push(unknownMark(update));
  }
  return rows;
}

/** Soonest running countdown. A recorded done or not-applicable mark leaves the legal instant in place and drops it from this pick. */
export function nextCountdown(deadlines: readonly ComputedDeadline[]): ComputedDeadline | null {
  const running = deadlines.filter((deadline) => {
    if (!deadline.dueAt || !RUNNING.has(deadline.clockStatus)) return false;
    const mark = deadline.recorded?.status;
    return mark !== "done" && mark !== "not_applicable";
  });
  running.sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime() || a.rule.id.localeCompare(b.rule.id));
  return running[0] ?? null;
}

function sec(profile: IncidentState["profile"]): Decision {
  if (!profile.publicCompany) {
    return none(SEC_NOTE, "The profile does not mark a public company. Form 8-K Item 1.05 is not placed on this incident.");
  }
  return on(
    "sec-4",
    SEC_NOTE,
    "The profile marks a public company. Item 1.05 runs from the materiality determination. A discovery time does not start it.",
  );
}

function hipaaIndividuals(profile: IncidentState["profile"], exposure: Exposure): Decision {
  if (!profile.hipaaCoveredEntity) {
    if (exposure.phiOpen || exposure.phiUnresolved) {
      return check(
        HIPAA_NOTE,
        "PHI is on the record and the profile does not mark a HIPAA covered entity. Counsel confirms whether the entity is a covered entity or a business associate. No HIPAA countdown is started.",
      );
    }
    return none(HIPAA_NOTE, "The profile does not mark a HIPAA covered entity. The HIPAA breach rules are not placed on this incident.");
  }
  if (exposure.phiOpen) {
    return on(
      "days-60",
      HIPAA_NOTE,
      "The profile marks a HIPAA covered entity, and PHI is suspected, exfiltrated, or encrypted. 45 CFR 164.404 requires individual notice no later than 60 calendar days after discovery.",
    );
  }
  if (exposure.scopeEmpty || exposure.phiUnresolved || exposure.phiClosed || exposure.unresolved) {
    return check(
      HIPAA_NOTE,
      "The profile marks a HIPAA covered entity, and current scope does not show suspected, exfiltrated, or encrypted PHI. Counsel confirms whether notice is still required. No countdown is started.",
    );
  }
  return none(HIPAA_NOTE, "The profile marks a HIPAA covered entity, and no PHI exposure is on the record. 45 CFR 164.404 is not placed on this incident.");
}

function hipaaSecretary(state: IncidentState, profile: IncidentState["profile"], exposure: Exposure): Decision {
  const individual = hipaaIndividuals(profile, exposure);
  const note = `${HIPAA_NOTE} Under 500 individuals, 45 CFR 164.408(c) is an annual log rather than a 60-day incident countdown.`;
  if (individual.applicability === "no") {
    return none(note, "Individual HIPAA notice is not on this incident, so the HHS notice is not placed here either.");
  }
  if (individual.applicability === "check" || !exposure.phiOpen) {
    return check(note, "Counsel first confirms whether a HIPAA breach is on this record. No HHS countdown is started.");
  }
  if (exposure.phiRecords >= 500) {
    return on(
      "days-60",
      note,
      `Recorded PHI counts total ${exposure.phiRecords}, which meets the 500-individual line in 45 CFR 164.408(b). Notice to HHS uses the same 60 calendar days as individual notice.`,
    );
  }
  if (exposure.phiRecordsIncomplete) {
    return check(
      note,
      `Recorded PHI counts are a lower bound of ${exposure.phiRecords} because at least one exposed PHI system has no record count. Whether the breach reaches 500 individuals is undecided. No countdown is started.`,
    );
  }
  return check(
    note,
    `Recorded PHI counts total ${exposure.phiRecords}, under 500. 45 CFR 164.408(c) keeps an annual log due 60 days after the end of the calendar year. ${annualLogHint(state)} No 60-day countdown is started.`,
  );
}

function hipaaMedia(profile: IncidentState["profile"], exposure: Exposure): Decision {
  const individual = hipaaIndividuals(profile, exposure);
  const note = `${HIPAA_NOTE} Media notice uses "more than 500 residents" of one state. 500 exactly does not qualify. The HHS threshold of 500 or more is a different count.`;
  if (individual.applicability === "no") {
    return none(note, "Individual HIPAA notice is not on this incident, so the media notice is not placed here either.");
  }
  if (individual.applicability === "check" || !exposure.phiOpen) {
    return check(note, "Counsel first confirms whether a HIPAA breach is on this record. No media countdown is started.");
  }
  const over = [...exposure.phiStates.entries()].filter(([, count]) => count > 500);
  if (over.length > 0) {
    const list = over.map(([code, count]) => `${stateName(code)} ${count}`).join(", ");
    return on(
      "days-60",
      note,
      `More than 500 residents are recorded in ${list}. 45 CFR 164.406 requires media notice no later than 60 calendar days after discovery.`,
    );
  }
  if (exposure.phiStatesIncomplete) {
    return check(
      note,
      "No recorded state count of PHI is over 500, and at least one exposed PHI system has no resident list. The media line is undecided. No countdown is started.",
    );
  }
  return none(note, "Every recorded state count of PHI is 500 or fewer. 45 CFR 164.406 is not placed on this incident.");
}

function texasIndividuals(exposure: Exposure): Decision {
  if (exposure.texasCount >= 1) {
    return on(
      "days-60",
      TEXAS_NOTE,
      `${exposure.texasCount} Texas residents are recorded on a suspected or exfiltrated system holding sensitive personal information. Section 521.053(b) requires notice not later than the 60th day after the determination date.`,
    );
  }
  if (exposure.spiOpen && exposure.texasIncomplete) {
    return check(
      TEXAS_NOTE,
      "Sensitive personal information is exposed, and at least one of those systems has no resident list. The Texas count is incomplete. No countdown is started.",
    );
  }
  if (exposure.spiEncrypted || exposure.spiClosed || exposure.unresolved) {
    return check(
      TEXAS_NOTE,
      "Texas notice is not ruled out. Encrypted data, a closed system, or an incomplete scope can still be a breach under section 521.053. No countdown is started.",
    );
  }
  return none(TEXAS_NOTE, "No Texas residents with sensitive personal information are on an exposed system. Section 521.053(b) is not placed on this incident.");
}

function texasAttorneyGeneral(exposure: Exposure): Decision {
  const note = `${TEXAS_NOTE} Attorney general notice applies at 250 Texas residents.`;
  if (exposure.texasCount >= 250) {
    return on(
      "days-30",
      note,
      `${exposure.texasCount} Texas residents are recorded. Section 521.053(i) requires attorney general notice not later than the 30th day after the determination date.`,
    );
  }
  if (exposure.texasCount >= 1 && !exposure.texasIncomplete) {
    return none(
      note,
      `${exposure.texasCount} Texas residents are recorded, which is under 250. Section 521.053(i) is not placed on this incident.`,
    );
  }
  if (exposure.texasCount >= 1 && exposure.texasIncomplete) {
    return check(
      note,
      `${exposure.texasCount} Texas residents are recorded, under 250, and another exposed system has no resident list. Whether the breach reaches 250 is undecided. No attorney general countdown is started.`,
    );
  }
  if (exposure.texasIncomplete || exposure.spiEncrypted || exposure.spiClosed || exposure.unresolved) {
    return check(note, "The Texas resident count is incomplete or the sensitive-data facts are not closed. No attorney general countdown is started.");
  }
  return none(note, "The 250-resident line in section 521.053(i) is not met on this record.");
}

function stateNotices(state: IncidentState, exposure: Exposure): ComputedDeadline[] {
  const codes = new Set<string>();
  for (const [code, count] of exposure.stateCounts) {
    if (code !== "TX" && count > 0) codes.add(code);
  }
  for (const code of exposure.encryptedStates) {
    if (code !== "TX") codes.add(code);
  }
  const rows = [...codes].sort().map((code) => stateNotice(state, code));
  if (exposure.stateIncomplete) rows.push(unknownStateNotice(state));
  return rows;
}

function stateNotice(state: IncidentState, code: string): ComputedDeadline {
  const name = stateName(code);
  const california = code === "CA";
  const rule: LegalRule = {
    id: `state-check-${code.toLowerCase()}`,
    name: `${name} resident notice`,
    jurisdiction: name,
    citation: california ? "Cal. Civ. Code 1798.82" : "State breach-notification statute",
    sourceUrl: CALIFORNIA_URL,
    appliesWhen: "Residents of this state appear on an exposed system, and this engine has no computed deadline for that state's statute.",
    trigger: "None. Counsel decides whether a state clock has started.",
    calculation: california
      ? "Cal. Civ. Code 1798.82(a)(2), effective January 1, 2026, states 30 calendar days, with statutory delays. This engine does not start that countdown."
      : "No day count is encoded. Counsel identifies the statute.",
    timeZone: null,
  };
  const explanation = california
    ? "California residents are on an exposed system. Cal. Civ. Code 1798.82(a)(2), as amended effective January 1, 2026, says disclosure shall be made within 30 calendar days of discovery, and it allows delay for law enforcement or to determine the scope and restore the system. Those conditions are not decided here. No California countdown is started."
    : `${name} residents are on an exposed system. This engine does not encode a ${name} deadline. The linked page is Cal. Civ. Code 1798.82, an example of a state notice statute with its own clock and exceptions. It is not ${name} law. No countdown is started.`;
  return {
    rule,
    applicability: "check",
    clockStatus: "needs_counsel",
    startedAt: null,
    dueAt: null,
    explanation,
    counselReview: counsel(STATE_NOTE),
    recorded: recordedFor(state, rule.id),
  };
}

function unknownStateNotice(state: IncidentState): ComputedDeadline {
  const rule: LegalRule = {
    id: "state-check-unknown",
    name: "Unlisted resident notice",
    jurisdiction: "Unlisted state",
    citation: "State breach-notification statute",
    sourceUrl: CALIFORNIA_URL,
    appliesWhen: "An exposed system holding personal data has no resident list.",
    trigger: "None.",
    calculation: "No day count is encoded.",
    timeZone: null,
  };
  return {
    rule,
    applicability: "check",
    clockStatus: "needs_counsel",
    startedAt: null,
    dueAt: null,
    explanation:
      "An exposed system holding personal data has no resident list. Counsel identifies the states and their statutes. The linked page is Cal. Civ. Code 1798.82, an example of a state statute this engine does not turn into a countdown. No countdown is started.",
    counselReview: counsel(STATE_NOTE),
    recorded: recordedFor(state, rule.id),
  };
}

function unknownMark(update: DeadlineUpdate): ComputedDeadline {
  const ruleId = update.body?.ruleId ?? "unknown";
  const rule: LegalRule = {
    id: ruleId,
    name: "Recorded deadline mark",
    jurisdiction: "Recorded by the incident team",
    citation: ruleId,
    sourceUrl: "",
    appliesWhen: "A deadline update uses a rule id this engine does not compute.",
    trigger: "deadline.update",
    calculation: "No date is calculated.",
    timeZone: null,
  };
  return {
    rule,
    applicability: "check",
    clockStatus: "needs_counsel",
    startedAt: null,
    dueAt: null,
    explanation: `The record has a deadline update for ${ruleId}. This engine has no statute for that id. No countdown is shown.`,
    counselReview: counsel("A workflow mark does not create a statutory deadline."),
    recorded: recordedFrom(update),
  };
}

function finish(
  state: IncidentState,
  now: Date | null,
  rule: LegalRule,
  decision: Decision,
  trigger: TriggerKind,
): ComputedDeadline {
  const recorded = recordedFor(state, rule.id);
  const counselReview = counsel(decision.counselNote);
  if (decision.applicability === "no" || decision.due === null) {
    return {
      rule,
      applicability: decision.applicability,
      clockStatus: decision.applicability === "no" ? "not_applicable" : "needs_counsel",
      startedAt: null,
      dueAt: null,
      explanation: decision.explanation,
      counselReview,
      recorded,
    };
  }
  const resolved = resolveTrigger(state, trigger, now);
  if (resolved.kind !== "ok") {
    return {
      rule,
      applicability: "applies",
      clockStatus: resolved.kind === "absent" ? "not_started" : resolved.kind,
      startedAt: resolved.kind === "future_trigger" ? resolved.at : null,
      dueAt: null,
      explanation: `${decision.explanation} ${triggerProblem(resolved.kind, trigger)}`,
      counselReview,
      recorded,
    };
  }
  const computed = computeDue(decision.due, resolved.at);
  if (!computed) {
    return {
      rule,
      applicability: "applies",
      clockStatus: "needs_counsel",
      startedAt: resolved.at,
      dueAt: null,
      explanation: `${decision.explanation} The federal holiday list in this engine covers 2026 and 2027 only (${OPM_HOLIDAY_URL}). No due date is shown for a business-day count outside those years.`,
      counselReview,
      recorded,
    };
  }
  if (!now) {
    return {
      rule,
      applicability: "applies",
      clockStatus: "needs_counsel",
      startedAt: resolved.at,
      dueAt: computed.dueAt,
      explanation: `${decision.explanation} ${computed.detail} The current time passed to the engine is unusable, so the window is not marked running or elapsed.`,
      counselReview,
      recorded,
    };
  }
  return {
    rule,
    applicability: "applies",
    clockStatus: statusFromDue(computed.dueAt, now),
    startedAt: resolved.at,
    dueAt: computed.dueAt,
    explanation: `${decision.explanation} ${computed.detail}`,
    counselReview,
    recorded,
  };
}

function resolveTrigger(
  state: IncidentState,
  trigger: TriggerKind,
  now: Date | null,
): { kind: "absent" } | { kind: "invalid_trigger" } | { kind: "future_trigger"; at: Date } | { kind: "ok"; at: Date } {
  const value = trigger === "discovery" ? state.discovery?.determinedAt : state.materiality?.determinedAt;
  if (value == null) return { kind: "absent" };
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return { kind: "invalid_trigger" };
  if (now && value.getTime() > now.getTime()) return { kind: "future_trigger", at: value };
  return { kind: "ok", at: value };
}

function triggerProblem(kind: "absent" | "invalid_trigger" | "future_trigger", trigger: TriggerKind): string {
  const label = trigger === "discovery" ? "discovery time" : "materiality determination";
  if (kind === "absent") return `The clock has not started. No ${label} is on the record.`;
  if (kind === "invalid_trigger") return `The recorded ${label} is unusable. No countdown is shown.`;
  return `The recorded ${label} is later than the clock passed to this engine. No countdown is shown.`;
}

function computeDue(kind: DueKind, start: Date): DueResult | null {
  if (kind === "days-60" || kind === "days-30") {
    const days = kind === "days-60" ? 60 : 30;
    const dueAt = endOfNthCalendarDay(start, days, CIVIL_ZONE);
    return {
      dueAt,
      detail: `Due at the end of ${civilDate(dueAt, CIVIL_ZONE)} in America/Chicago, ${days} calendar days after the trigger's civil date. The due instant is the last millisecond of that day.`,
    };
  }
  const walk = addBusinessDays(start, 4, SEC_ZONE);
  if (!walk) return null;
  const dueAt = zonedWallTime(walk.dueDate, SEC_FILING_HOUR, SEC_FILING_MINUTE, SEC_ZONE);
  const skipped = walk.skippedHolidays.length
    ? `Federal holidays skipped: ${walk.skippedHolidays.map((holiday) => `${holiday.name} (${holiday.date})`).join(", ")}.`
    : "No federal holiday fell on a day this count stepped through.";
  return {
    dueAt,
    detail: `Due at 5:30 p.m. America/New_York on ${walk.dueDate}, the fourth business day after the materiality determination. ${skipped} Weekends are skipped. The determination date is not counted.`,
  };
}

function statusFromDue(dueAt: Date, now: Date): ClockStatus {
  const delta = dueAt.getTime() - now.getTime();
  if (delta < 0) return "elapsed";
  if (delta <= DUE_SOON_MS) return "due_soon";
  return "scheduled";
}

function readExposure(state: IncidentState): Exposure {
  const exposure = emptyExposure();
  const items = state.scope ?? [];
  if (items.length === 0) {
    exposure.scopeEmpty = true;
    return exposure;
  }
  for (const item of items) {
    const body = item?.latest;
    if (!body || !Array.isArray(body.dataTypes)) {
      exposure.unresolved = true;
      continue;
    }
    const personal = body.dataTypes.some((type) => PERSONAL.has(type));
    const spi = body.dataTypes.some((type) => SPI.has(type));
    const phi = body.dataTypes.includes("phi");
    const status = body.status;
    const geography = Array.isArray(body.affected) && body.affected.length > 0 ? body.affected : null;
    if (status === "unknown" || body.dataTypes.length === 0) exposure.unresolved = true;
    if (OPEN.has(status) && personal) {
      exposure.personalOpen = true;
      addStates(exposure.stateCounts, geography);
      if (!geography) exposure.stateIncomplete = true;
    }
    if (status === "encrypted" && personal) {
      exposure.personalEncrypted = true;
      if (geography) {
        for (const resident of geography) {
          if (resident.count > 0) exposure.encryptedStates.add(resident.state);
        }
      } else {
        exposure.stateIncomplete = true;
      }
    }
    if (CLOSED.has(status) && (personal || phi)) exposure.personalClosed = true;
    if (HIPAA_OPEN.has(status) && phi) {
      exposure.phiOpen = true;
      if (typeof body.recordCount === "number" && Number.isFinite(body.recordCount)) exposure.phiRecords += body.recordCount;
      else exposure.phiRecordsIncomplete = true;
      if (geography) addStates(exposure.phiStates, geography);
      else exposure.phiStatesIncomplete = true;
    }
    if (status === "unknown" && phi) exposure.phiUnresolved = true;
    if (CLOSED.has(status) && phi) exposure.phiClosed = true;
    if (OPEN.has(status) && spi) {
      exposure.spiOpen = true;
      if (!geography) {
        exposure.texasIncomplete = true;
      } else {
        exposure.texasCount += geography.filter((resident) => resident.state === "TX").reduce((sum, resident) => sum + resident.count, 0);
      }
    }
    if (status === "encrypted" && spi) exposure.spiEncrypted = true;
    if (CLOSED.has(status) && (spi || phi)) exposure.spiClosed = true;
  }
  return exposure;
}

function addStates(target: Map<string, number>, residents: { state: string; count: number }[] | null): void {
  if (!residents) return;
  for (const resident of residents) {
    if (!resident || typeof resident.state !== "string" || !Number.isFinite(resident.count) || resident.count <= 0) continue;
    target.set(resident.state, (target.get(resident.state) ?? 0) + resident.count);
  }
}

function annualLogHint(state: IncidentState): string {
  const at = state.discovery?.determinedAt;
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    return "The calendar year of the log is known once discovery is recorded.";
  }
  const year = Number(civilDate(at, CIVIL_ZONE).slice(0, 4));
  const logDate = addIsoDays(`${year}-12-31`, 60);
  return `For a discovery in ${year}, that log date falls on ${logDate}. It is stated here for counsel and is not a started countdown.`;
}

function emptyExposure(): Exposure {
  return {
    scopeEmpty: false,
    unresolved: false,
    personalOpen: false,
    personalEncrypted: false,
    personalClosed: false,
    phiOpen: false,
    phiClosed: false,
    phiUnresolved: false,
    phiRecords: 0,
    phiRecordsIncomplete: false,
    phiStates: new Map(),
    phiStatesIncomplete: false,
    spiOpen: false,
    spiEncrypted: false,
    spiClosed: false,
    texasCount: 0,
    texasIncomplete: false,
    stateCounts: new Map(),
    encryptedStates: new Set(),
    stateIncomplete: false,
  };
}

function on(due: DueKind, counselNote: string, explanation: string): Decision {
  return { applicability: "applies", due, counselNote, explanation };
}

function check(counselNote: string, explanation: string): Decision {
  return { applicability: "check", due: null, counselNote, explanation };
}

function none(counselNote: string, explanation: string): Decision {
  return { applicability: "no", due: null, counselNote, explanation };
}

function counsel(note: string): string {
  return `${note} ${COUNSEL_REVIEW_WARNING}`;
}

function recordedFor(state: IncidentState, ruleId: string): RecordedDeadline | null {
  return recordedFrom(state.deadlineUpdates?.[ruleId]);
}

function recordedFrom(update: DeadlineUpdate | undefined): RecordedDeadline | null {
  if (!update?.body) return null;
  const status = update.body.status;
  if (status !== "open" && status !== "in_progress" && status !== "done" && status !== "not_applicable") return null;
  const at = update.at instanceof Date ? update.at : new Date(Number.NaN);
  return {
    status,
    note: typeof update.body.note === "string" ? update.body.note : "",
    ...(typeof update.body.owner === "string" ? { owner: update.body.owner } : {}),
    at,
  };
}

function stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};
