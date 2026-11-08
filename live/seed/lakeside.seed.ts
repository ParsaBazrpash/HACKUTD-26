// Demo seed: plays the Lakeside Family Clinic story into the real database with headless clients (WP8).
//
//   ZH_SEED_ENROLL_LINKS="<link1>,<link2>,..." ZH_SEED_PAGER_PUB="<NEXT_PUBLIC_PAGER_PUB>" npm run seed:demo
//
// For a rehearsal, add NEXT_PUBLIC_SPACETIMEDB_DB_NAME=zerohour-hackutd26-scratch here and run
// `npm run dev` with the same value in .env.local.
//
// What it does, in order:
//   1. Reads its inputs and stops with a plain message if one is missing or malformed.
//   2. Enrolls one bot per link (in cast order: Jordan, Sam, Lee, Priya, Drew, Casey) and prints
//      "Approve <name>: safety code <code>". You match the code and approve each in the org screen.
//      Casey is left enrolled but unapproved on purpose.
//   3. Waits until every other bot is approved, added to the incident and active with integrity checked.
//   4. Posts the bots' beats in time order, one every ZH_SEED_PACE_MS.
//   5. Prints the lines Avery (and the two human cast members) paste, in order, with the screen for each.
//   6. Has every bot run verifyAll() and prints one line per bot.
//   7. With ZH_SEED_LIVE=1, stays connected and posts one short update per minute until stopped.
//
// Inputs (environment):
//   ZH_SEED_ENROLL_LINKS  comma-separated enrollment links, one per bot, in cast order (required)
//   ZH_SEED_PAGER_PUB     the production NEXT_PUBLIC_PAGER_PUB (required)
//   NEXT_PUBLIC_SPACETIMEDB_DB_NAME  database name, default zerohour-hackutd26
//   NEXT_PUBLIC_SPACETIMEDB_HOST     default wss://maincloud.spacetimedb.com
//   ZH_SEED_T0            ISO time of the incident start, default 02:13 America/Chicago today
//   ZH_SEED_PACE_MS       pause between posts, default 1500
//   ZH_SEED_WAIT_MIN      minutes to wait for each approval and each add, default 20
//   ZH_SEED_LIVE          1 for live mode
//
// The bots are ordinary clients: every entry is sealed, signed and chained like a person's. Nothing here
// touches the module or the database directly. Output has names, safety codes, counts and results only.

import 'fake-indexeddb/auto';
import { describe, it } from 'vitest';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { b64urlDecode } from '@/lib/crypto/b64url';
import { isRawPublicKey } from '@/lib/crypto/keys';
import { IncidentStore, useStoreForTests as makeTestStore } from '@/lib/crypto/store';
import { DeviceVault, type WebAuthnPort } from '@/lib/client/passkey-lock';
import { RealIncidentClient } from '@/lib/client/real';
import { SpacetimeBackend, type TokenStore } from '@/lib/client/spacetime-backend';
import { parseEnrollFragment } from '@/lib/protocol/org';
import type { IncidentState, ScopeBody, TaskBody, TimelineBody, EvidenceBody, ProfileBody, DiscoveryBody, DeadlineBody, StatusBody } from '@/lib/client/types';
import {
  BEATS,
  BOT_KEYS,
  CAST,
  DEMO_INCIDENT_TITLE,
  LIVE_BEATS,
  isActionBeat,
  minutesAfter,
  resolveBeat,
  type Beat,
  type CastEntry,
  type CastKey,
  type PayloadBeat,
} from '@/lib/scenario/lakeside-story';

const HOST = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || 'wss://maincloud.spacetimedb.com';

const say = (msg: string) => console.log(msg);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stop the person running the script can act on. Never carries a secret. */
class SeedStop extends Error {
  constructor(message: string) {
    super(`Seed stopped: ${message}`);
  }
}

// --- Inputs -----------------------------------------------------------------------

interface Inputs {
  fragments: string[];
  pagerPub: Uint8Array;
  db: string;
  t0: Date;
  paceMs: number;
  waitMin: number;
  live: boolean;
}

/** 02:13 America/Chicago on the current Chicago calendar day, as a UTC instant. */
export function defaultT0(now = new Date()): Date {
  const zone = 'America/Chicago';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 2, 13);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (shown - guess));
}

function readInputs(env: NodeJS.ProcessEnv): Inputs {
  const rawLinks = (env.ZH_SEED_ENROLL_LINKS ?? '').trim();
  if (!rawLinks) throw new SeedStop('ZH_SEED_ENROLL_LINKS is not set. Make one enrollment link per bot on /org and put them in it, separated by commas.');
  const links = rawLinks.split(',').map((s) => s.trim()).filter(Boolean);
  if (links.length !== BOT_KEYS.length) {
    throw new SeedStop(`ZH_SEED_ENROLL_LINKS has ${links.length} links but the cast has ${BOT_KEYS.length} bots (in order: ${BOT_KEYS.map((k) => nameOf(k)).join(', ')}).`);
  }
  const fragments = links.map((link, i) => {
    const hash = link.indexOf('#');
    const frag = hash >= 0 ? parseEnrollFragment(link.slice(hash + 1)) : null;
    if (!frag) throw new SeedStop(`Link ${i + 1} (for ${nameOf(BOT_KEYS[i])}) is not a valid enrollment link.`);
    return link.slice(hash + 1);
  });

  const pub = (env.ZH_SEED_PAGER_PUB ?? '').trim();
  if (!pub) throw new SeedStop('ZH_SEED_PAGER_PUB is not set. Use the production NEXT_PUBLIC_PAGER_PUB.');
  let pagerPub: Uint8Array;
  try {
    pagerPub = b64urlDecode(pub);
  } catch {
    throw new SeedStop('ZH_SEED_PAGER_PUB is not valid base64url.');
  }
  if (!isRawPublicKey(pagerPub)) throw new SeedStop('ZH_SEED_PAGER_PUB is not a P-256 public key.');

  const db = (env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME ?? '').trim() || 'zerohour-hackutd26';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(db)) throw new SeedStop('NEXT_PUBLIC_SPACETIMEDB_DB_NAME is not a valid database name.');

  const t0Raw = (env.ZH_SEED_T0 ?? '').trim();
  let t0 = defaultT0();
  if (t0Raw) {
    t0 = new Date(t0Raw);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(t0Raw) || Number.isNaN(t0.getTime())) {
      throw new SeedStop('ZH_SEED_T0 must be an ISO time with an offset, such as 2026-11-08T02:13:00-06:00 or ending in Z.');
    }
  }

  const whole = (name: string, fallback: number, min: number, max: number): number => {
    const v = (env[name] ?? '').trim();
    if (!v) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new SeedStop(`${name} must be a whole number from ${min} to ${max}.`);
    return n;
  };
  const paceMs = whole('ZH_SEED_PACE_MS', 1500, 0, 60_000);
  const waitMin = whole('ZH_SEED_WAIT_MIN', 20, 1, 50);
  const liveRaw = (env.ZH_SEED_LIVE ?? '').trim();
  if (liveRaw && liveRaw !== '1' && liveRaw !== '0') throw new SeedStop('ZH_SEED_LIVE must be 1, 0 or empty.');

  return { fragments, pagerPub, db, t0, paceMs, waitMin, live: liveRaw === '1' };
}

const castOf = (key: string): CastEntry => {
  const c = CAST.find((x) => x.key === key);
  if (!c) throw new SeedStop(`The story refers to ${key}, who is not in the cast.`);
  return c;
};
const nameOf = (key: string) => castOf(key).displayName;

// --- Headless clients ------------------------------------------------------------------

const memoryTokens = (): TokenStore => {
  let t: string | undefined;
  return { read: () => t, write: (v) => void (t = v) };
};

/** A fake authenticator: PRF = HMAC(secret, salt), like CTAP2 hmac-secret with a test secret. */
function authenticator(): WebAuthnPort {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return {
    supported: async () => true,
    create: async (salt) => ({ credentialId: new Uint8Array([9, 9, 9]), prf: hmac(sha256, secret, salt), prfEnabled: true }),
    get: async (_id, salt) => hmac(sha256, secret, salt),
  };
}

const until = async (pred: () => boolean, what: string, ms: number) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new SeedStop(`timed out waiting for ${what}.`);
    await sleep(200);
  }
};

interface Bot {
  key: CastKey;
  entry: CastEntry;
  backend: SpacetimeBackend;
  client: RealIncidentClient;
  /** Set once the commander revoked this bot and a post was refused. */
  stopped: boolean;
}

async function makeBot(key: CastKey, inputs: Inputs): Promise<Bot> {
  const db = makeTestStore(`seed-${key}-${crypto.randomUUID()}`);
  const backend = new SpacetimeBackend(HOST, inputs.db, memoryTokens());
  const vault = new DeviceVault({ store: db, webauthn: authenticator() });
  await vault.enable();
  const client = new RealIncidentClient(backend, {
    origin: 'https://zerohour.live',
    storeFor: (id) => new IncidentStore(id, db),
    keyStore: db,
    waitMs: 15_000,
    vault,
    pagerPub: inputs.pagerPub,
    // Bots are never paged.
    postPage: async () => ({ ok: false }),
  });
  await until(() => backend.connection() === 'ready' && backend.identityHex() !== null, `${castOf(key).displayName} to connect`, 60_000);
  return { key, entry: castOf(key), backend, client, stopped: false };
}

// --- Story playing ------------------------------------------------------------------

const ct = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const offset = (min: number) => `T0+${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

function personIn(state: IncidentState, key: CastKey): string | undefined {
  const name = nameOf(key);
  return state.members.find((m) => m.displayName === name && m.state !== 'revoked')?.identity;
}

async function enrollAndApprove(bots: Bot[], inputs: Inputs) {
  const wait = inputs.waitMin * 60_000;
  const codes: string[] = [];
  for (const [i, bot] of bots.entries()) {
    const { safetyCode } = await bot.client.enroll({
      fragment: inputs.fragments[i],
      displayName: bot.entry.displayName,
      phone: bot.entry.phone!,
    });
    codes.push(safetyCode);
    if (bot.entry.orgState === 'pending') say(`${bot.entry.displayName}: safety code ${safetyCode}. Leave pending, do not approve.`);
    else say(`Approve ${bot.entry.displayName}: safety code ${safetyCode}`);
  }
  for (const bot of bots) {
    if (bot.entry.orgState === 'pending') {
      say(`${bot.entry.displayName}: enrolled and left unapproved on purpose`);
      continue;
    }
    say(`Waiting for you to approve ${bot.entry.displayName}`);
    await until(() => bot.client.getState().org !== null, `you to approve ${bot.entry.displayName} in the org screen`, wait);
    say(`${bot.entry.displayName}: approved`);
  }
}

async function waitForIncident(bots: Bot[], inputs: Inputs) {
  const wait = inputs.waitMin * 60_000;
  const add = CAST.filter((c) => c.role && c.role !== 'commander' && c.player !== 'mock_only');
  say(`Create the incident titled "${DEMO_INCIDENT_TITLE}" and add from the roster: ${add.map((c) => `${c.displayName} (${c.role})`).join(', ')}.`);
  for (const bot of bots) {
    if (bot.entry.orgState === 'pending') continue;
    say(`Waiting for ${bot.entry.displayName} to be added to an incident`);
    const mine = () =>
      bot.backend
        .rows()
        .status.filter((r) => r.state !== 'revoked')
        .sort((a, b) => Number(b.joinedAtMicros - a.joinedAtMicros))[0];
    await until(() => mine() !== undefined, `you to add ${bot.entry.displayName} to the incident`, wait);
    await bot.client.openIncident(mine()!.incidentId);
    await until(
      () => bot.client.getState().me?.state === 'active' && bot.client.getState().integrity.ok,
      `${bot.entry.displayName} to become active with integrity checked`,
      wait,
    );
    const role = bot.client.getState().me?.role;
    if (role !== bot.entry.role) {
      throw new SeedStop(`${bot.entry.displayName} was added as ${role}, but the story needs ${bot.entry.role}. Add them with the right role and run again with fresh links.`);
    }
    say(`${bot.entry.displayName}: active as ${role}, integrity checked`);
  }
}

async function post(bot: Bot, beat: PayloadBeat, ids: Map<string, string>, entryIds: Map<string, string>, t0: Date) {
  const state = bot.client.getState();
  const resolved = resolveBeat(beat, {
    t0,
    person: (k) => personIn(state, k),
    localId: (k) => {
      let id = ids.get(k);
      if (!id) ids.set(k, (id = crypto.randomUUID()));
      return id;
    },
    entryId: (k) => {
      const id = entryIds.get(k);
      if (!id) throw new SeedStop(`could not find the earlier entry "${k}" to amend.`);
      return id;
    },
  });
  const c = bot.client;
  const body = resolved.body;
  switch (resolved.kind) {
    case 'status.set':
      return c.setStatus(body as unknown as StatusBody);
    case 'timeline.add':
      return c.addTimelineEntry(body as unknown as Omit<TimelineBody, 'entryId'>);
    case 'scope.set':
      return c.upsertScopeItem(body as unknown as ScopeBody);
    case 'task.set':
      return c.upsertTask(body as unknown as TaskBody);
    case 'profile.set':
      return c.setProfile(body as unknown as ProfileBody);
    case 'legal.discovery':
      return c.recordDiscovery(body as unknown as DiscoveryBody);
    case 'deadline.update':
      return c.updateDeadline(body as unknown as DeadlineBody);
    case 'evidence.add':
      return c.addEvidence(body as unknown as Omit<EvidenceBody, 'evidenceId'>);
    case 'chat.post': {
      if (resolved.channel === 'record') throw new SeedStop('a chat beat is on the record channel.');
      return c.postMessage(resolved.channel, { text: String(body.text), mentions: body.mentions as string[] });
    }
    default:
      throw new SeedStop(`bots cannot post ${resolved.kind}.`);
  }
}

/** Finds the entryId of an earlier timeline beat in the author's own folded state. */
async function learnEntryId(bot: Bot, earlier: Extract<PayloadBeat, { kind: 'timeline.add' }>): Promise<string> {
  let found: string | undefined;
  await until(
    () => {
      found = bot.client.getState().timeline.find((t) => t.entry.text === earlier.body.text && t.by?.displayName === bot.entry.displayName)?.entry.entryId;
      return found !== undefined;
    },
    `${bot.entry.displayName}'s earlier entry to appear before amending it`,
    30_000,
  );
  return found!;
}

async function playBots(botsByKey: Map<CastKey, Bot>, inputs: Inputs) {
  const ids = new Map<string, string>();
  const entryIds = new Map<string, string>();
  const mine = BEATS.filter((b): b is PayloadBeat => !isActionBeat(b) && castOf(b.by).player === 'bot');
  say(`Playing ${mine.length} beats from the bots, one every ${inputs.paceMs} ms`);
  let n = 0;
  const waited = new Set<Beat>();
  for (const beat of mine) {
    const bot = botsByKey.get(beat.by);
    if (!bot) throw new SeedStop(`no bot for ${beat.by}.`);
    if (beat.kind === 'chat.post') {
      // Earlier chat lines by people in the same channel must be on screen first, so the chat reads in order.
      const earlier = BEATS.filter(
        (b): b is Extract<PayloadBeat, { kind: 'chat.post' }> =>
          b.kind === 'chat.post' && b.channel === beat.channel && b.at < beat.at && castOf(b.by).player !== 'bot' && !waited.has(b),
      );
      for (const line of earlier) {
        waited.add(line);
        say(`Now paste in #${line.channel} as ${nameOf(line.by)} (${offset(line.at)}): ${line.body.text}`);
        await until(
          () => bot.client.getState().channels.find((c) => c.kind === line.channel)?.messages.some((m) => m.text === line.body.text) === true,
          `${nameOf(line.by)}'s line in #${line.channel}`,
          inputs.waitMin * 60_000,
        );
        say(`Seen in #${line.channel}. Continuing.`);
      }
    }
    if (beat.kind === 'timeline.add' && beat.body.amends) {
      const earlier = BEATS.find((b) => b.kind === 'timeline.add' && b.key === beat.body.amends) as Extract<PayloadBeat, { kind: 'timeline.add' }>;
      entryIds.set(beat.body.amends, await learnEntryId(bot, earlier));
    }
    try {
      await post(bot, beat, ids, entryIds, inputs.t0);
    } catch (e) {
      throw new SeedStop(`${bot.entry.displayName} could not post ${beat.kind} at ${offset(beat.at)}: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    n += 1;
    say(`[${offset(beat.at)}] ${bot.entry.displayName} ${beat.kind}${beat.channel === 'record' ? '' : ` in #${beat.channel}`} ok (${n}/${mine.length})`);
    await sleep(inputs.paceMs);
  }
  return n;
}

// --- Lines for the people ---------------------------------------------------------------

function screenFor(beat: Beat): string {
  switch (beat.kind) {
    case 'incident.title':
      return 'New incident screen, title field';
    case 'status.set':
      return 'Overview, status card';
    case 'timeline.add':
      return `Timeline, add entry (phase ${beat.body.phase}, framework ${beat.body.csf})`;
    case 'chat.post':
      return `#${beat.channel} chat`;
    case 'ui.page':
      return 'People page, Call button';
    case 'ui.revoke':
      return 'People page, Revoke';
    default:
      return 'the matching screen';
  }
}

function textFor(beat: Beat): string {
  switch (beat.kind) {
    case 'incident.title':
      return beat.body.title;
    case 'status.set':
      return `${beat.body.severity}, ${beat.body.phase}: ${beat.body.summary}`;
    case 'timeline.add':
      return beat.body.text;
    case 'chat.post':
      return beat.body.text;
    case 'ui.page':
      return `Call ${beat.who.filter((k) => castOf(k).player !== 'bot').map(nameOf).join(', ')}`;
    case 'ui.revoke':
      return `Revoke ${nameOf(beat.who)}. Reason: ${beat.reason}`;
    default:
      return '';
  }
}

function printPasteLines(t0: Date) {
  const show = (who: string, title: string) => {
    const lines = BEATS.filter((b) => b.by === who);
    if (lines.length === 0) return;
    say('');
    say(`=== ${title}: ${lines.length} lines, in order ===`);
    for (const b of lines) {
      const when = `${offset(b.at)} (${ct(new Date(minutesAfter(t0, b.at)))} CT)`;
      const occurred = b.kind === 'timeline.add' ? `, occurred at ${ct(new Date(minutesAfter(t0, b.body.occurredAt)))} CT` : '';
      say('');
      say(`${when}, ${screenFor(b)}${occurred}`);
      say(textFor(b));
    }
  };
  show('avery', `${nameOf('avery')} pastes these`);
  for (const c of CAST.filter((x) => x.player === 'human')) show(c.key, `${c.displayName} posts these`);
  say('');
}

// --- Live mode ----------------------------------------------------------------------------

async function runLive(botsByKey: Map<CastKey, Bot>, startedAt: number) {
  const end = startedAt + 57 * 60_000;
  say(`Live mode: one update per minute. It stops by itself at ${ct(new Date(end))} CT, or stop the script sooner.`);
  for (let i = 0; Date.now() < end; i += 1) {
    const live = LIVE_BEATS[i % LIVE_BEATS.length];
    const bot = botsByKey.get(live.by);
    if (bot && !bot.stopped) {
      try {
        await bot.client.postMessage(live.channel, { text: live.text, mentions: [] });
        say(`live: ${bot.entry.displayName} posted in #${live.channel}`);
      } catch (e) {
        const revoked = bot.client.getState().me?.state === 'revoked';
        say(`live: ${bot.entry.displayName} refused: ${revoked ? 'removed from the incident by the commander' : e instanceof Error ? e.message : 'could not send'}`);
        bot.stopped = true;
      }
    }
    if ([...botsByKey.values()].every((b) => b.stopped)) {
      say('live: every bot has stopped');
      return;
    }
    await sleep(60_000);
  }
}

// --- The run ---------------------------------------------------------------------------------

describe('Lakeside demo seed', () => {
  it('plays the story into the database', async () => {
    const startedAt = Date.now();
    const inputs = readInputs(process.env);
    say(`Database ${inputs.db}. Incident start T0 is ${ct(inputs.t0)} CT.`);

    const bots: Bot[] = [];
    for (const key of BOT_KEYS) bots.push(await makeBot(key, inputs));
    const botsByKey = new Map(bots.map((b) => [b.key, b]));
    try {
      await enrollAndApprove(bots, inputs);
      await waitForIncident(bots, inputs);

      const posted = await playBots(botsByKey, inputs);
      printPasteLines(inputs.t0);

      let failures = 0;
      for (const bot of bots) {
        if (bot.entry.orgState === 'pending') continue;
        const report = await bot.client.verifyAll();
        const checked = Object.values(report.channels).reduce((sum, ch) => sum + (ch?.eventsChecked ?? 0), 0);
        const bad = Object.values(report.channels).reduce((sum, ch) => sum + (ch?.failures.length ?? 0), 0) + report.rosterFailures.length;
        if (!report.ok) failures += 1;
        say(`${bot.entry.displayName}: verifyAll ${report.ok ? 'ok' : 'FAILED'}, ${checked} events checked, ${bad} problems`);
      }
      say(`Done: ${posted} bot beats posted, ${failures === 0 ? 'every bot verified ok' : `${failures} bots failed verification`}.`);
      if (failures > 0) throw new SeedStop(`${failures} bots failed verification.`);

      if (inputs.live) await runLive(botsByKey, startedAt);
    } finally {
      for (const bot of bots) bot.client.dispose();
    }
  });
});
