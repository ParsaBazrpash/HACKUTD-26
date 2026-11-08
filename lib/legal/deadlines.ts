import type { DeadlineUpdate, IncidentState } from "@/lib/client/types";
import { EMPTY_PROFILE } from "@/lib/client/types";
import {
  CIVIL_ZONE,
  OPM_HOLIDAY_URL,
  SEC_FILING_HOUR,
  SEC_FILING_MINUTE,
  SEC_ZONE,
  addBusinessDays,
  addElapsedHours,
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
 * CIRCIA is listed so the statute is not mistaken for a live clock. CISA's
 * CIRCIA page, opened November 7, 2026, says covered-incident and ransom
 * reports are not required until the final rule's effective date.
 */

const GDPR_URL = "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679";
const SEC_FORM_URL = "https://www.sec.gov/files/form8-k.pdf";
const HIPAA_404_URL = "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.404";
const HIPAA_406_URL = "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.406";
const HIPAA_408_URL = "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D/section-164.408";
const HHS_RANSOMWARE_URL =
  "https://www.hhs.gov/hipaa/for-professionals/security/guidance/cybersecurity/ransomware-fact-sheet/index.html";
const TEXAS_URL = "https://statutes.capitol.texas.gov/Docs/BC/htm/BC.521.htm";
const NYDFS_URL = "https://www.dfs.ny.gov/cybersecurity/submissions";
const DFARS_URL =
  "https://www.acquisition.gov/dfars/252.204-7012-safeguarding-covered-defense-information-and-cyber-incident-reporting.";
const BANK_URL = "https://www.ecfr.gov/current/title-12/chapter-I/part-53/section-53.3";
const CIRCIA_URL =
  "https://www.cisa.gov/topics/cyber-threats-and-advisories/information-sharing/cyber-incident-reporting-critical-infrastructure-act-2022-circia";
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

const GDPR_RULE: LegalRule = {
  id: "gdpr-33",
  name: "GDPR supervisory notice",
  jurisdiction: "European Union",
  citation: "GDPR Article 33",
  sourceUrl: GDPR_URL,
  appliesWhen: "The profile marks EU data subjects, and a suspected or exfiltrated system holds personal data or a count of EU residents.",
  trigger: "legal.discovery. Awareness of the controller. A missing discovery time means the clock has not started.",
  calculation: "72 elapsed hours from the discovery instant. An hour is 3,600,000 milliseconds.",
  timeZone: null,
};

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

const NYDFS_RULE: LegalRule = {
  id: "nydfs-50017",
  name: "NYDFS cybersecurity notice",
  jurisdiction: "New York",
  citation: "23 NYCRR 500.17(a)",
  sourceUrl: NYDFS_URL,
  appliesWhen: "The profile marks an NYDFS covered entity. Counsel still confirms the event is a cybersecurity incident as defined in 23 NYCRR 500.1.",
  trigger: "legal.discovery, used as the determination that a cybersecurity incident occurred.",
  calculation: "72 elapsed hours from that determination. The separate extortion-payment notices are not started.",
  timeZone: null,
};

const DFARS_RULE: LegalRule = {
  id: "dfars-7012",
  name: "DFARS cyber incident report",
  jurisdiction: "United States",
  citation: "DFARS 252.204-7012(c)",
  sourceUrl: DFARS_URL,
  appliesWhen: "The profile marks a defense contractor. Counsel confirms the clause is in the contract and the incident meets paragraph (c).",
  trigger: "legal.discovery. The clause defines rapidly report as within 72 hours of discovery.",
  calculation: "72 elapsed hours from discovery.",
  timeZone: null,
};

const BANK_RULE: LegalRule = {
  id: "bank-36h",
  name: "Bank regulator notice",
  jurisdiction: "United States",
  citation: "12 CFR 53.3",
  sourceUrl: BANK_URL,
  appliesWhen: "The profile marks a bank. Counsel confirms the event is a notification incident. Many cyber events are not.",
  trigger: "legal.discovery, used as the determination that a notification incident occurred.",
  calculation: "36 elapsed hours from that determination. Parallel Federal Reserve and FDIC rules use the same interagency standard.",
  timeZone: null,
};

export const CIRCIA_RULE: LegalRule = {
  id: "circia-reporting",
  name: "CIRCIA covered-incident reporting",
  jurisdiction: "United States",
  citation: "6 U.S.C. 681b",
  sourceUrl: CIRCIA_URL,
  appliesWhen: "Not in effect. The statute directs CISA to issue a rule. Reporting begins on the final rule's effective date.",
  trigger: "None. A discovery time, a defense-contractor flag, or a ransom note in the timeline does not start a CIRCIA clock.",
  calculation: "No countdown. The proposed 72-hour and 24-hour periods are not operative filing deadlines.",
  timeZone: null,
};

export const LEGAL_RULES: readonly LegalRule[] = [
  GDPR_RULE,
  SEC_RULE,
  HIPAA_404_RULE,
  HIPAA_408_RULE,
  HIPAA_406_RULE,
  TEXAS_INDIVIDUAL_RULE,
  TEXAS_AG_RULE,
  NYDFS_RULE,
  DFARS_RULE,
  BANK_RULE,
];

const GDPR_NOTE =
  "Article 33 applies unless the controller can show the breach is unlikely to result in a risk to the rights and freedoms of natural persons. This engine does not decide that exception.";
const SEC_NOTE =
  "Item 1.05 is the registrant's materiality determination. A Department of Justice delay applies only when the Attorney General notifies the Commission in writing before the Form 8-K would be due. This engine does not apply that delay.";
const HIPAA_NOTE = `45 CFR 164.404 covers a breach of unsecured PHI. HHS ransomware guidance treats ransomware encryption of ePHI as a presumed breach unless a low probability of compromise is documented (${HHS_RANSOMWARE_URL}). A law-enforcement delay under 45 CFR 164.412 is not applied here.`;
const TEXAS_NOTE =
  "Sensitive personal information is defined in section 521.002. The record stores data categories, not the statutory name-plus-element combination. Encrypted data is a breach under section 521.053(a) only when the actor has the key. A law-enforcement delay is not applied here.";
const NYDFS_NOTE =
  "A cybersecurity incident is an event that requires notice to another authority, has a reasonable likelihood of materially harming operations, or deploys ransomware in a material part of the systems. Extortion-payment notice is a separate 24-hour duty, with a further explanation at 30 days. Those clocks are not started.";
const DFARS_NOTE =
  "Paragraph (c) applies when the incident affects a covered contractor information system, covered defense information, or operationally critical support identified in the contract. The profile flag does not establish those facts.";
const BANK_NOTE =
  "12 CFR 53.3 runs from the determination that a notification incident occurred. Counsel confirms the event meets that defined term. Parallel Federal Reserve and FDIC rules are the same interagency standard.";
const STATE_NOTE =
  "State breach statutes differ in who must notify, what data counts, and whether any day count exists. This engine computes Texas and flags every other state for counsel.";

type DueKind = "hours-72" | "hours-36" | "days-60" | "days-30" | "sec-4";
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
  euOpen: boolean;
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
    finish(state, clock, GDPR_RULE, gdpr(profile, exposure), "discovery"),
    finish(state, clock, SEC_RULE, sec(profile), "materiality"),
    finish(state, clock, HIPAA_404_RULE, hipaaIndividuals(profile, exposure), "discovery"),
    finish(state, clock, HIPAA_408_RULE, hipaaSecretary(state, profile, exposure), "discovery"),
    finish(state, clock, HIPAA_406_RULE, hipaaMedia(profile, exposure), "discovery"),
    finish(state, clock, TEXAS_INDIVIDUAL_RULE, texasIndividuals(exposure), "discovery"),
    finish(state, clock, TEXAS_AG_RULE, texasAttorneyGeneral(exposure), "discovery"),
    finish(state, clock, NYDFS_RULE, profileGate(profile.nydfsRegulated, "NYDFS", NYDFS_NOTE, "hours-72"), "discovery"),
    finish(state, clock, DFARS_RULE, profileGate(profile.defenseContractor, "DFARS 252.204-7012", DFARS_NOTE, "hours-72"), "discovery"),
    finish(state, clock, BANK_RULE, profileGate(profile.bank, "12 CFR 53.3", BANK_NOTE, "hours-36"), "discovery"),
    circia(state),
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

function gdpr(profile: IncidentState["profile"], exposure: Exposure): Decision {
  if (!profile.euDataSubjects) {
    if (exposure.euOpen) {
      return check(
        GDPR_NOTE,
        "The profile does not mark EU data subjects, but scope records EU residents on an exposed system. Counsel resolves that conflict. No GDPR countdown is started.",
      );
    }
    return none(GDPR_NOTE, "The profile does not mark EU data subjects. GDPR Article 33 is not placed on this incident.");
  }
  if (exposure.personalOpen || exposure.euOpen) {
    return on(
      "hours-72",
      GDPR_NOTE,
      "The profile marks EU data subjects, and an exposed system holds personal data or a count of EU residents. Article 33 runs from awareness, read here from the recorded discovery time.",
    );
  }
  if (exposure.scopeEmpty || exposure.unresolved || exposure.personalEncrypted || exposure.personalClosed) {
    return check(
      GDPR_NOTE,
      "The profile marks EU data subjects, and the scope does not show suspected or exfiltrated personal data. Encrypted-only loss, a closed system, or an incomplete record stays with counsel. No GDPR countdown is started.",
    );
  }
  return none(
    GDPR_NOTE,
    "The profile marks EU data subjects, and the exposed systems on the record do not hold personal data. GDPR Article 33 is not placed on this incident.",
  );
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

function profileGate(flag: boolean, label: string, counselNote: string, due: DueKind): Decision {
  if (!flag) {
    return none(counselNote, `The profile does not mark this organization for ${label}. That rule is not placed on this incident.`);
  }
  return on(
    due,
    counselNote,
    `The profile marks this organization for ${label}. The countdown is the statutory outer limit once counsel confirms the incident meets the rule's own definition.`,
  );
}

function circia(state: IncidentState): ComputedDeadline {
  return {
    rule: CIRCIA_RULE,
    applicability: "no",
    clockStatus: "not_in_effect",
    startedAt: null,
    dueAt: null,
    explanation:
      "CISA's CIRCIA page, read November 7, 2026, says covered cyber incident reports and ransom payment reports are not required until the final rule's effective date. The NPRM was published April 4, 2024. A draft final rule was submitted to OIRA on October 1, 2026. That review is not Federal Register publication, and it sets no effective date. 6 U.S.C. 681b tells CISA to write the rule. It is not itself a filing deadline. Voluntary sharing with CISA is not a countdown.",
    counselReview: counsel(
      "Confirm the final rule's effective date before any CIRCIA period is used. Do not start 72 hours from discovery or 24 hours from a ransom payment on the statute alone.",
    ),
    recorded: recordedFor(state, CIRCIA_RULE.id),
  };
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
  if (kind === "hours-72" || kind === "hours-36") {
    const hours = kind === "hours-72" ? 72 : 36;
    const dueAt = addElapsedHours(start, hours);
    return {
      dueAt,
      detail: `Due ${hours} elapsed hours after the trigger. An hour is 3,600,000 milliseconds, so a daylight-saving change moves the wall clock and leaves the elapsed count unchanged.`,
    };
  }
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
    const eu = typeof body.euResidents === "number" && Number.isFinite(body.euResidents) ? body.euResidents : 0;
    if (status === "unknown" || body.dataTypes.length === 0) exposure.unresolved = true;
    if (OPEN.has(status) && eu > 0) exposure.euOpen = true;
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
    if (CLOSED.has(status) && (personal || phi || eu > 0)) exposure.personalClosed = true;
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
    euOpen: false,
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
