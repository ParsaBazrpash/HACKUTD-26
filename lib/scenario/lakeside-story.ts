// Lakeside Family Clinic demo story (WP8).
//
// The cast and every beat of one ransomware night, as typed data. The seed script
// (live/seed/lakeside.seed.ts) replays it through real headless clients; tests check it
// against the payload schema and the role policy. Everything here is fictional.
//
// Rules for this file:
// - Types and enums only come in from the protocol and policy files. No crypto, no network.
// - Times inside bodies are minute offsets from T0 (02:13 America/Chicago on the demo day).
//   The consumer turns them into ISO dates.
// - People in bodies (assignee, owner, mentions) are cast keys. The consumer maps them to
//   identities by display name.
// - Scope items and tasks carry a local key. A later beat with the same key updates the same
//   item. Timeline beats may carry a key so a later beat can amend them.
// - Phones use the 555-0100 to 555-0199 range reserved for fiction.
// - Story numbers: 41,200 patients (12,400 with SSNs), 342 staff, 37 charts, 18.6 GB.

import type { ChannelKind, Role } from '@/spacetimedb/src/shared/policy';
import type {
  ChatBody,
  DeadlineBody,
  DiscoveryBody,
  EvidenceBody,
  PayloadKind,
  ProfileBody,
  ScopeBody,
  StatusBody,
  TaskBody,
  TimelineBody,
  TitleBody,
} from '@/lib/protocol/events';

export type Player = 'presenter' | 'human' | 'bot' | 'mock_only';
export type OrgState = 'admin' | 'active' | 'pending' | 'revoked';

export interface CastEntry {
  key: string;
  displayName: string;
  title: string;
  /** Incident role. Null when the person is never in the incident. */
  role: Role | null;
  orgState: OrgState;
  player: Player;
  /** Fictional stand-in phone for bots, 555-0100 to 555-0199. */
  phone?: string;
}

export const CAST = [
  { key: 'avery', displayName: 'Avery Chen', title: 'Chief operating officer', role: 'commander', orgState: 'admin', player: 'presenter' },
  { key: 'jordan', displayName: 'Jordan Hale', title: 'Outside breach counsel', role: 'counsel', orgState: 'active', player: 'bot', phone: '+12145550101' },
  { key: 'sam', displayName: 'Sam Okonkwo', title: 'IT manager', role: 'technical', orgState: 'active', player: 'bot', phone: '+12145550102' },
  { key: 'morgan', displayName: 'Morgan Diaz', title: 'Forensics firm lead', role: 'technical', orgState: 'active', player: 'human' },
  { key: 'lee', displayName: 'Lee Carter', title: 'Systems engineer', role: 'technical', orgState: 'active', player: 'bot', phone: '+12145550103' },
  { key: 'riley', displayName: 'Riley Patel', title: 'Medical director', role: 'executive', orgState: 'active', player: 'human' },
  { key: 'priya', displayName: 'Priya Shah', title: 'Privacy officer', role: 'executive', orgState: 'active', player: 'bot', phone: '+12145550104' },
  { key: 'drew', displayName: 'Drew Kim', title: 'Managed service provider engineer', role: 'technical', orgState: 'active', player: 'bot', phone: '+12145550105' },
  { key: 'noah', displayName: 'Noah Ellis', title: 'Network technician', role: 'technical', orgState: 'active', player: 'mock_only' },
  { key: 'casey', displayName: 'Casey Brooks', title: 'Front desk lead', role: null, orgState: 'pending', player: 'bot', phone: '+12145550106' },
  { key: 'taylor', displayName: 'Taylor Nguyen', title: 'Billing specialist', role: null, orgState: 'revoked', player: 'mock_only' },
] as const satisfies readonly CastEntry[];

export type CastKey = (typeof CAST)[number]['key'];

/** Bots in cast order: the order of the enrollment links. */
export const BOT_KEYS: readonly CastKey[] = CAST.filter((c) => c.player === 'bot').map((c) => c.key);

export const DEMO_ORG_NAME = 'Lakeside Family Clinic';
export const DEMO_INCIDENT_TITLE = 'Ransomware at Lakeside Family Clinic';

const DAY = 24 * 60;

// --- Demo artifacts for evidence ------------------------------------------------

export const RANSOM_NOTE_TEXT =
  'Your files at Lakeside were encrypted and a copy of your data was taken. ' +
  'Do not contact the police or recovery companies. Visit the private chat address below within 72 hours. ' +
  'This is a fictional demo note for the HAVEN demonstration.';

export const EGRESS_LOG_TEXT =
  'FW-VPN-01 egress export, demo excerpt\n' +
  '03:40 outbound tcp/443 10.20.4.17 to object-store.example.test 1.2 GB\n' +
  '04:05 outbound tcp/443 10.20.4.17 to object-store.example.test 7.9 GB\n' +
  '04:55 outbound tcp/443 10.20.4.17 to object-store.example.test 9.5 GB\n' +
  'total in window: 18.6 GB';

export const MAILBOX_RULE_TEXT =
  'M365-LAKESIDE mailbox rule export, demo excerpt\n' +
  'mailbox: administrator\n' +
  'rule: forward all mail to an outside address, created by the MSP admin account\n' +
  'rule state: enabled until removed during containment';

// --- Beat types -----------------------------------------------------------------

interface Common {
  /** Minutes after T0. */
  at: number;
  by: CastKey;
}

type TimelineStory = Omit<TimelineBody, 'entryId' | 'occurredAt' | 'amends'> & {
  /** Minutes after T0. */
  occurredAt: number;
  /** Local key of an earlier timeline beat by the same author. */
  amends?: string;
};
type TaskStory = Omit<TaskBody, 'taskId' | 'assignee' | 'dueAt'> & {
  assignee?: CastKey;
  /** Minutes after T0. */
  dueAt?: number;
};
type DiscoveryStory = Omit<DiscoveryBody, 'determinedAt'> & { determinedAt: number };
type DeadlineStory = Omit<DeadlineBody, 'owner'> & { owner?: CastKey };
type EvidenceStory = Omit<EvidenceBody, 'evidenceId' | 'sha256'> & {
  /** The demo text whose SHA-256 is carried below. */
  artifact: string;
  sha256: string;
};
type ChatStory = Omit<ChatBody, 'messageId' | 'mentions' | 'replyTo'> & { mentions?: CastKey[] };

export type PayloadBeat = Common &
  (
    | { kind: 'incident.title'; channel: 'record'; body: TitleBody }
    | { kind: 'status.set'; channel: 'record'; body: StatusBody }
    | { kind: 'timeline.add'; channel: 'record'; key?: string; body: TimelineStory }
    | { kind: 'scope.set'; channel: 'record'; key: string; body: Omit<ScopeBody, 'itemId'> }
    | { kind: 'task.set'; channel: 'record'; key: string; body: TaskStory }
    | { kind: 'profile.set'; channel: 'record'; body: ProfileBody }
    | { kind: 'legal.discovery'; channel: 'record'; body: DiscoveryStory }
    | { kind: 'deadline.update'; channel: 'record'; body: DeadlineStory }
    | { kind: 'evidence.add'; channel: 'record'; body: EvidenceStory }
    | { kind: 'chat.post'; channel: 'command' | 'privileged' | 'technical'; body: ChatStory }
  );

/** Things the commander does in a screen that are not payloads of their own. */
export type ActionBeat = Common &
  (
    | { kind: 'ui.page'; who: CastKey[] }
    | { kind: 'ui.revoke'; who: CastKey; reason: string }
  );

export type Beat = PayloadBeat | ActionBeat;

export const isActionBeat = (b: Beat): b is ActionBeat => b.kind === 'ui.page' || b.kind === 'ui.revoke';

/** A short update a bot posts in live mode, one per minute. */
export interface LiveBeat {
  by: CastKey;
  channel: 'command' | 'technical';
  text: string;
}

// --- The night ------------------------------------------------------------------

export const BEATS: readonly Beat[] = [
  { at: 0, by: 'avery', kind: 'incident.title', channel: 'record', body: { title: DEMO_INCIDENT_TITLE } },
  {
    at: 0,
    by: 'sam',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 0,
      phase: 'detection_analysis',
      csf: 'DE.AE',
      text: 'Alert on FS-CLINIC-01: mass file renames. RESTORE-FILES.txt is on the shared drive at both sites.',
    },
  },
  {
    at: 2,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'fs',
    body: {
      system: 'FS-CLINIC-01 file server',
      assetType: 'server',
      status: 'encrypted',
      dataTypes: ['employee_hr', 'other_pii'],
      affected: [],
      notes: 'Shares are encrypted and renamed. Staff files are on this server. Record count unknown.',
    },
  },
  {
    at: 3,
    by: 'sam',
    kind: 'task.set',
    channel: 'record',
    key: 'task-image-fs',
    body: { title: 'Image FS-CLINIC-01 and preserve the ransom note', assignee: 'sam', status: 'open' },
  },
  {
    at: 4,
    by: 'avery',
    kind: 'status.set',
    channel: 'record',
    body: {
      severity: 'SEV2',
      phase: 'detection_analysis',
      summary: 'File server encrypted at Plano. Scope still unknown. Phones are unreliable, so we are using HAVEN.',
    },
  },
  {
    at: 9,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'hv',
    body: {
      system: 'HV-01 hypervisor',
      assetType: 'server',
      status: 'encrypted',
      dataTypes: [],
      affected: [],
      notes: 'Hosts the phone system and the practice database. Virtual machines will not start.',
    },
  },
  {
    at: 10,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'voip',
    body: {
      system: 'VOIP-PBX-01 phone system',
      assetType: 'other',
      status: 'encrypted',
      dataTypes: [],
      affected: [],
      notes: 'Desk phones are down at Plano and McKinney.',
    },
  },
  {
    at: 14,
    by: 'lee',
    kind: 'scope.set',
    channel: 'record',
    key: 'm365',
    body: {
      system: 'M365-LAKESIDE email',
      assetType: 'saas',
      status: 'suspected',
      dataTypes: ['credentials'],
      affected: [],
      notes: 'A forwarding rule on the administrator mailbox sends mail outside. Someone may be reading clinic email.',
    },
  },
  {
    at: 17,
    by: 'avery',
    kind: 'chat.post',
    channel: 'command',
    body: { text: 'Desk phones are down and someone is reading clinic email. Personal phones and this room only.' },
  },
  {
    at: 18,
    by: 'avery',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 18,
      phase: 'detection_analysis',
      csf: 'RS.MA',
      text: 'Decision: all incident traffic moves to HAVEN on personal phones. Clinic email and Teams are off limits.',
    },
  },
  {
    at: 20,
    by: 'avery',
    kind: 'status.set',
    channel: 'record',
    body: {
      severity: 'SEV1',
      phase: 'containment',
      summary: 'Both sites on paper downtime. Isolating affected systems. Email treated as compromised.',
    },
  },
  { at: 22, by: 'avery', kind: 'ui.page', who: ['morgan', 'priya', 'lee'] },
  {
    at: 34,
    by: 'sam',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 34,
      phase: 'containment',
      csf: 'RS.CO',
      text: 'Both sites are on paper downtime. Patients already in the building are still being seen.',
    },
  },
  {
    at: 38,
    by: 'sam',
    kind: 'task.set',
    channel: 'record',
    key: 'task-image-fs',
    body: { title: 'Image FS-CLINIC-01 and preserve the ransom note', assignee: 'sam', status: 'done' },
  },
  {
    at: 41,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'vpn',
    body: {
      system: 'FW-VPN-01 VPN',
      assetType: 'network',
      status: 'contained',
      dataTypes: ['credentials'],
      affected: [],
      notes: 'Isolated after outbound traffic to an unfamiliar host. Entry point looks like the MSP admin account.',
    },
  },
  {
    at: 41,
    by: 'sam',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 41,
      phase: 'containment',
      csf: 'RS.MI',
      text: 'FW-VPN-01 isolated from the network after outbound traffic to an unfamiliar host.',
    },
  },
  {
    at: 48,
    by: 'jordan',
    kind: 'chat.post',
    channel: 'privileged',
    body: {
      text:
        'PRIVILEGED AND CONFIDENTIAL, attorney-client communication. We will engage the forensics firm through this office. ' +
        'No one contacts the attacker. No payment discussion until sanctions (OFAC) screening is done.',
    },
  },
  {
    at: 49,
    by: 'jordan',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 49,
      phase: 'containment',
      csf: 'RS.MA',
      text: 'Decision: engage the forensics firm through outside counsel',
    },
  },
  {
    at: 52,
    by: 'jordan',
    kind: 'task.set',
    channel: 'record',
    key: 'task-sanctions',
    body: { title: 'Sanctions screening and the no-contact rule', assignee: 'jordan', status: 'done' },
  },
  {
    at: 55,
    by: 'avery',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 55,
      phase: 'containment',
      csf: 'RS.MA',
      text: 'Decision: engage the forensics firm through outside counsel so its report stays privileged.',
    },
  },
  {
    at: 58,
    by: 'jordan',
    kind: 'task.set',
    channel: 'record',
    key: 'task-insurer',
    body: { title: 'Notify the cyber insurer', assignee: 'jordan', status: 'done' },
  },
  {
    at: 62,
    by: 'jordan',
    kind: 'profile.set',
    channel: 'record',
    body: {
      publicCompany: false,
      hipaaCoveredEntity: true,
      nydfsRegulated: false,
      defenseContractor: false,
      bank: false,
      euDataSubjects: false,
    },
  },
  {
    at: 65,
    by: 'jordan',
    kind: 'legal.discovery',
    channel: 'record',
    body: {
      determinedAt: 0,
      basis: 'Ransom note on the file server and the first evidence of data export. Clock starts at T0.',
    },
  },
  {
    at: 66,
    by: 'jordan',
    kind: 'task.set',
    channel: 'record',
    key: 'task-fbi',
    body: { title: 'FBI Dallas field office and IC3 report', assignee: 'avery', status: 'in_progress' },
  },
  {
    at: 69,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'pm',
    body: {
      system: 'PM-SQL-01 practice database',
      assetType: 'database',
      status: 'suspected',
      dataTypes: ['phi', 'ssn'],
      recordCount: 41_200,
      affected: [{ state: 'TX', count: 41_200 }],
      notes: 'Active patient records, all Texas residents. Access by the attacker is suspected, not confirmed.',
    },
  },
  {
    at: 70,
    by: 'sam',
    kind: 'timeline.add',
    channel: 'record',
    key: 'pm-note',
    body: {
      occurredAt: 70,
      phase: 'detection_analysis',
      csf: 'RS.AN',
      text: 'PM-SQL-01 holds 41,200 active patient records. First read: SSNs are on file for all of them.',
    },
  },
  {
    at: 72,
    by: 'sam',
    kind: 'task.set',
    channel: 'record',
    key: 'task-pm-count',
    body: { title: 'Confirm the PM-SQL-01 patient count and the SSN subset', assignee: 'sam', status: 'in_progress' },
  },
  {
    at: 75,
    by: 'morgan',
    kind: 'chat.post',
    channel: 'technical',
    body: { text: 'About 18.6 GB went out to a cloud storage host between 03:40 and 04:55 CT the night before encryption.' },
  },
  {
    at: 76,
    by: 'lee',
    kind: 'task.set',
    channel: 'record',
    key: 'task-fw-logs',
    body: { title: 'Export firewall logs for the egress window', assignee: 'morgan', status: 'in_progress' },
  },
  {
    at: 80,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'backup',
    body: {
      system: 'BACKUP-VEEAM',
      assetType: 'backup',
      status: 'contained',
      dataTypes: ['phi', 'employee_hr'],
      affected: [],
      notes: 'The Friday 18:40 job is intact and offline. Not reachable from the clinic network.',
    },
  },
  {
    at: 85,
    by: 'sam',
    kind: 'evidence.add',
    channel: 'record',
    body: {
      label: 'Ransom note, RESTORE-FILES.txt',
      artifact: RANSOM_NOTE_TEXT,
      sha256: '3af692ab8be71ed65622724b1691fb5dba67069c42f714a7554ac472003f9985',
      location: 'Image of FS-CLINIC-01, evidence store 1',
      custodian: 'Sam Okonkwo',
    },
  },
  {
    at: 91,
    by: 'lee',
    kind: 'evidence.add',
    channel: 'record',
    body: {
      label: 'Firewall egress log export',
      artifact: EGRESS_LOG_TEXT,
      sha256: '2d29038892b7518d23f012c53eaec1e45726f1f828092ceb522ce35a8b0a1edf',
      location: 'Forensics firm transfer folder',
      custodian: 'Morgan Diaz',
    },
  },
  {
    at: 95,
    by: 'lee',
    kind: 'task.set',
    channel: 'record',
    key: 'task-fw-logs',
    body: { title: 'Export firewall logs for the egress window', assignee: 'morgan', status: 'done' },
  },
  {
    at: 100,
    by: 'riley',
    kind: 'chat.post',
    channel: 'command',
    body: { text: 'Both sites are open on paper. The front desk needs a holding statement by 07:30.' },
  },
  {
    at: 104,
    by: 'priya',
    kind: 'chat.post',
    channel: 'command',
    body: { text: 'Main line is busy. The answering service is taking messages. I started the patient call script.' },
  },
  {
    at: 108,
    by: 'sam',
    kind: 'task.set',
    channel: 'record',
    key: 'task-paper',
    body: { title: 'Paper downtime staffing through Monday', assignee: 'riley', status: 'in_progress' },
  },
  {
    at: 110,
    by: 'jordan',
    kind: 'chat.post',
    channel: 'privileged',
    body: {
      text:
        'HHS treats ransomware on ePHI as a presumed breach unless we show a low probability of compromise. ' +
        'Texas Attorney General notice is due within 30 days of determination (250 or more Texans). Individuals within 60 days.',
    },
  },
  {
    at: 112,
    by: 'jordan',
    kind: 'task.set',
    channel: 'record',
    key: 'task-script',
    body: { title: 'Patient call script and holding statement', assignee: 'priya', status: 'open' },
  },
  {
    at: 125,
    by: 'jordan',
    kind: 'deadline.update',
    channel: 'record',
    body: { ruleId: 'tx-521-ag', status: 'in_progress', owner: 'jordan', note: 'Texas AG portal draft started.' },
  },
  {
    at: 126,
    by: 'jordan',
    kind: 'deadline.update',
    channel: 'record',
    body: { ruleId: 'hipaa-408', status: 'in_progress', owner: 'priya', note: 'HHS breach report in progress.' },
  },
  {
    at: 127,
    by: 'jordan',
    kind: 'deadline.update',
    channel: 'record',
    body: { ruleId: 'hipaa-406', status: 'open', note: 'Media notice: decide once the patient count is confirmed.' },
  },
  {
    at: 128,
    by: 'jordan',
    kind: 'deadline.update',
    channel: 'record',
    body: { ruleId: 'sec-8k-105', status: 'not_applicable', note: 'Privately held, so no SEC filing.' },
  },
  {
    at: 129,
    by: 'jordan',
    kind: 'task.set',
    channel: 'record',
    key: 'task-tx-ag',
    body: { title: 'Texas AG portal draft', assignee: 'jordan', dueAt: 29 * DAY, status: 'open' },
  },
  {
    at: 130,
    by: 'jordan',
    kind: 'task.set',
    channel: 'record',
    key: 'task-hhs',
    body: { title: 'HHS breach report draft', assignee: 'priya', dueAt: 59 * DAY, status: 'open' },
  },
  {
    at: 130,
    by: 'sam',
    kind: 'chat.post',
    channel: 'technical',
    body: { text: 'The MSP confirms Drew Kim’s VPN admin credentials were used to get in.', mentions: ['avery'] },
  },
  {
    at: 132,
    by: 'avery',
    kind: 'ui.revoke',
    who: 'drew',
    reason: 'Credentials used by the attacker',
  },
  {
    at: 140,
    by: 'lee',
    kind: 'task.set',
    channel: 'record',
    key: 'task-rotate',
    body: { title: 'Rotate every privileged credential', assignee: 'lee', status: 'in_progress' },
  },
  {
    at: 150,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'pm',
    body: {
      system: 'PM-SQL-01 practice database',
      assetType: 'database',
      status: 'exfiltrated',
      dataTypes: ['phi', 'ssn'],
      recordCount: 41_200,
      affected: [{ state: 'TX', count: 41_200 }],
      notes: 'Egress logs match a copy of this database leaving the network. All patients are Texas residents.',
    },
  },
  {
    at: 151,
    by: 'avery',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 151,
      phase: 'containment',
      csf: 'RS.AN',
      text: 'Known: about 18.6 GB left the network the night before encryption. Treat this as double extortion.',
    },
  },
  {
    at: 160,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'hr',
    body: {
      system: 'HR-SQL-01 HR database',
      assetType: 'database',
      status: 'exfiltrated',
      dataTypes: ['ssn', 'employee_hr', 'financial_account'],
      recordCount: 342,
      affected: [{ state: 'TX', count: 342 }],
      notes: '342 current and former staff, all Texas residents.',
    },
  },
  {
    at: 165,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'ehr',
    body: {
      system: 'EHR-APP-01',
      assetType: 'server',
      status: 'suspected',
      dataTypes: ['phi'],
      recordCount: 37,
      affected: [{ state: 'TX', count: 37 }],
      notes: '37 charts were opened by the compromised account. All Texas patients.',
    },
  },
  {
    at: 170,
    by: 'riley',
    kind: 'chat.post',
    channel: 'privileged',
    body: { text: 'The board chair is asking whether we pay.' },
  },
  {
    at: 172,
    by: 'jordan',
    kind: 'chat.post',
    channel: 'privileged',
    body: {
      text: 'That is the commander’s call. My advice is no: backups are intact and payment does not guarantee deletion.',
    },
  },
  {
    at: 175,
    by: 'avery',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 175,
      phase: 'containment',
      csf: 'RS.MA',
      text: 'Decision: no ransom payment and no contact with the attacker.',
    },
  },
  {
    at: 190,
    by: 'sam',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 190,
      phase: 'detection_analysis',
      csf: 'RS.AN',
      text: 'Correction to the PM-SQL-01 note: 41,200 patients, and SSNs are on file for 12,400 of them, not all.',
      amends: 'pm-note',
    },
  },
  {
    at: 195,
    by: 'sam',
    kind: 'task.set',
    channel: 'record',
    key: 'task-restore',
    body: { title: 'Restore the file server after eradication', assignee: 'sam', status: 'blocked' },
  },
  {
    at: 210,
    by: 'lee',
    kind: 'evidence.add',
    channel: 'record',
    body: {
      label: 'Mailbox forwarding rule export',
      artifact: MAILBOX_RULE_TEXT,
      sha256: '4947e8ed6fb3f45749b174bbb686a0e9555cdb9fa5cea7bd9479f5386178c902',
      location: 'Forensics firm transfer folder',
      custodian: 'Lee Carter',
    },
  },
  {
    at: 240,
    by: 'sam',
    kind: 'scope.set',
    channel: 'record',
    key: 'vpn',
    body: {
      system: 'FW-VPN-01 VPN',
      assetType: 'network',
      status: 'eradicated',
      dataTypes: ['credentials'],
      affected: [],
      notes: 'Rebuilt from the vendor image. MSP admin account disabled and replaced.',
    },
  },
  {
    at: 260,
    by: 'avery',
    kind: 'timeline.add',
    channel: 'record',
    body: {
      occurredAt: 260,
      phase: 'eradication',
      csf: 'RC.RP',
      text: 'Decision: restore from the Friday offline backup only after eradication is confirmed.',
    },
  },
  {
    at: 270,
    by: 'avery',
    kind: 'status.set',
    channel: 'record',
    body: {
      severity: 'SEV1',
      phase: 'eradication',
      summary:
        'Entry point closed and VPN rebuilt. About 41,200 patients and 342 staff affected, all Texas. ' +
        'Restore from the offline backup after eradication is confirmed. Notices are being prepared.',
    },
  },
];

/** Short updates for live mode, posted one per minute in this order, then repeated. */
export const LIVE_BEATS: readonly LiveBeat[] = [
  { by: 'sam', channel: 'technical', text: 'Rebuild of the file server is at 40 percent. Restore is still blocked until the sweep finishes.' },
  { by: 'priya', channel: 'command', text: 'Patient call script is ready for review. Holding statement goes to the front desk next.' },
  { by: 'lee', channel: 'technical', text: 'Privileged credentials rotated: 18 of 31. Service accounts are next.' },
  { by: 'drew', channel: 'technical', text: 'Checking whether my account saw anything else on the VPN.' },
  { by: 'jordan', channel: 'command', text: 'Forensics engagement letter is signed. Their report will come to this office.' },
  { by: 'sam', channel: 'technical', text: 'Sweep of the McKinney workstations is clean so far. 22 of 40 checked.' },
  { by: 'priya', channel: 'command', text: 'Answering service reports 14 patient messages. None mention the incident.' },
  { by: 'lee', channel: 'technical', text: 'Privileged credentials rotated: 31 of 31. Verifying every service.' },
];

// --- Resolving a beat -----------------------------------------------------------

export interface ResolveCtx {
  /** The moment of the incident. */
  t0: Date;
  /** Identity hex for a cast key, or undefined if that person is not in the incident. */
  person(key: CastKey): string | undefined;
  /** A stable fresh id for a local scope or task key. */
  localId(key: string): string;
  /** The entryId of the earlier timeline beat with this local key. */
  entryId(key: string): string;
}

export interface Resolved {
  channel: ChannelKind;
  kind: PayloadKind;
  /** The payload body, without ids the client generates (entryId, evidenceId, messageId). */
  body: Record<string, unknown>;
}

export const minutesAfter = (t0: Date, minutes: number): string => new Date(t0.getTime() + minutes * 60_000).toISOString();

const hex = <T extends string>(ctx: ResolveCtx, key: T | undefined): string | undefined => (key === undefined ? undefined : ctx.person(key as CastKey));

/** Turns one payload beat into what the client sends. Pure. */
export function resolveBeat(beat: PayloadBeat, ctx: ResolveCtx): Resolved {
  const { channel, kind } = beat;
  switch (beat.kind) {
    case 'incident.title':
    case 'status.set':
    case 'profile.set':
      return { channel, kind, body: { ...beat.body } };
    case 'timeline.add': {
      const { occurredAt, amends, ...rest } = beat.body;
      return {
        channel,
        kind,
        body: { ...rest, occurredAt: minutesAfter(ctx.t0, occurredAt), ...(amends ? { amends: ctx.entryId(amends) } : {}) },
      };
    }
    case 'scope.set':
      return { channel, kind, body: { ...beat.body, itemId: ctx.localId(beat.key) } };
    case 'task.set': {
      const { assignee, dueAt, ...rest } = beat.body;
      const who = hex(ctx, assignee);
      return {
        channel,
        kind,
        body: {
          ...rest,
          taskId: ctx.localId(beat.key),
          ...(who ? { assignee: who } : {}),
          ...(dueAt === undefined ? {} : { dueAt: minutesAfter(ctx.t0, dueAt) }),
        },
      };
    }
    case 'legal.discovery':
      return { channel, kind, body: { ...beat.body, determinedAt: minutesAfter(ctx.t0, beat.body.determinedAt) } };
    case 'deadline.update': {
      const { owner, ...rest } = beat.body;
      const who = hex(ctx, owner);
      return { channel, kind, body: { ...rest, ...(who ? { owner: who } : {}) } };
    }
    case 'evidence.add': {
      const { label, sha256, location, custodian } = beat.body;
      return { channel, kind, body: { label, sha256, location, custodian } };
    }
    case 'chat.post': {
      const mentions = (beat.body.mentions ?? []).map((m) => ctx.person(m)).filter((x): x is string => typeof x === 'string');
      return { channel, kind, body: { text: beat.body.text, mentions } };
    }
  }
}
