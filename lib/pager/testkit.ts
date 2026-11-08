// Test-only helpers: a certified org, a sealed roster, and a fake Twilio and Spacetime behind one fetch.
// Not imported by app code.

import { b64urlEncode } from '@/lib/crypto/b64url';
import { bytesToHex } from '@/spacetimedb/src/shared/encoding';
import { generateDeviceKeys, type DeviceKeys } from '@/lib/crypto/keys';
import { randomBytes } from '@/lib/crypto/hash';
import { sealContact, signEnrollment, signPageRequest } from '@/lib/crypto/org';
import type { PageRequestWire } from '@/lib/protocol/org';
import type { PagerConfig } from './config';
import type { MemberRow, PageRow } from './spacetime';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const INCIDENT_ID = '33333333-3333-4333-8333-333333333333';
export const NOW = 1_800_000_000_000;
export const BASE = 'https://haven.example.com';
export const SID = `AC${'a'.repeat(32)}`;
export const TOKEN = 'test-auth-token-0123456789abcdef';
export const COMMANDER_PHONE = '+15550000001';
export const PHONES = ['+15551110001', '+15551110002', '+15551110003'];

export interface Person {
  keys: DeviceKeys;
  identity: string;
  orgMemberId: string;
  phone: string;
  sealed: Uint8Array;
  displayName: string;
}

export interface World {
  cfg: PagerConfig;
  pagerPriv: CryptoKey;
  pagerPub: Uint8Array;
  adminKeys: DeviceKeys;
  commander: Person;
  people: Person[];
  members: MemberRow[];
  pages: PageRow[];
  pageId: string;
  /** A valid signed body. Tests copy it and break one thing. */
  body: PageRequestWire;
}

async function person(w: { pagerPub: Uint8Array }, n: number, phone: string, name: string): Promise<Person> {
  const keys = await generateDeviceKeys();
  const identity = bytesToHex(randomBytes(32));
  return { keys, identity, orgMemberId: String(n), phone, sealed: await sealContact(w.pagerPub, ORG_ID, identity, phone), displayName: name };
}

export async function certify(admin: DeviceKeys, p: Person, sealed = p.sealed): Promise<string> {
  return b64urlEncode(
    await signEnrollment(admin.signPriv, {
      orgId: ORG_ID,
      identityHex: p.identity,
      displayName: p.displayName,
      signPub: p.keys.signPub,
      ecdhPub: p.keys.ecdhPub,
      sealedContact: sealed,
    }),
  );
}

export async function buildWorld(): Promise<World> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pagerPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const adminKeys = await generateDeviceKeys();
  const seed = { pagerPub };
  const commander = await person(seed, 1, COMMANDER_PHONE, 'Casey');
  const people = [await person(seed, 2, PHONES[0], 'Dana'), await person(seed, 3, PHONES[1], 'Tom'), await person(seed, 4, PHONES[2], 'Ravi')];
  const cfg: PagerConfig = {
    twilioSid: SID,
    twilioToken: TOKEN,
    twilioFrom: '+15559990000',
    pagerPrivateKey: b64urlEncode(pkcs8),
    adminPins: [adminKeys.signPub],
    spacetimeToken: 'spacetime-token',
    spacetimeHost: 'https://db.example.com',
    spacetimeDb: 'zerohour-test',
    publicBaseUrl: BASE,
    allowedNumbers: new Set(),
  };
  const row = (p: Person): MemberRow => ({
    orgId: ORG_ID,
    orgMemberId: p.orgMemberId,
    identity: p.identity,
    signPub: p.keys.signPub,
    ecdhPub: p.keys.ecdhPub,
    sealedContact: p.sealed,
    state: 'active',
  });
  const pageId = crypto.randomUUID().replace(/^(.{14})./, '$14');
  const rec = async (p: Person) => ({
    identity: p.identity,
    displayName: p.displayName,
    signPub: b64urlEncode(p.keys.signPub),
    ecdhPub: b64urlEncode(p.keys.ecdhPub),
    sealedContact: b64urlEncode(p.sealed),
    enrollSig: await certify(adminKeys, p),
  });
  const targets = await Promise.all(people.map(async (p) => ({ ...(await rec(p)), orgMemberId: p.orgMemberId })));
  const sig = await signPageRequest(commander.keys.signPriv, {
    orgId: ORG_ID,
    incidentId: INCIDENT_ID,
    pageId,
    sentAtMs: NOW,
    targets: people.map((p) => ({ orgMemberId: BigInt(p.orgMemberId), identityHex: p.identity })),
  });
  return {
    cfg,
    pagerPriv: pair.privateKey,
    pagerPub,
    adminKeys,
    commander,
    people,
    members: [commander, ...people].map(row),
    pages: people.map((p) => ({ pageId, incidentId: INCIDENT_ID, orgMemberId: p.orgMemberId, status: 'requested', requestedBy: commander.identity })),
    pageId,
    body: {
      orgId: ORG_ID,
      incidentId: INCIDENT_ID,
      pageId,
      sentAt: NOW,
      adminSignPub: b64urlEncode(adminKeys.signPub),
      commander: await rec(commander),
      targets,
      commanderSig: b64urlEncode(sig),
    },
  };
}

const hex = (b: Uint8Array): string => `0x${bytesToHex(b)}`;

export interface Recorder {
  fetch: typeof fetch;
  twilio: { to: string; twiml: string; callback: string }[];
  /** Page texts sent through the Messages API. */
  sms: { to: string; from: string; body: string }[];
  updates: { pageId: string; orgMemberId: string; status: string }[];
  /** Make the Spacetime SQL read fail. */
  failSql: boolean;
  /** Make Twilio refuse calls and texts. */
  failTwilio: boolean;
  /** Make Twilio refuse only texts. */
  failSms: boolean;
  /** Make Twilio refuse only calls. */
  failCall: boolean;
}

/** One fetch for Twilio REST, Spacetime SQL and the pager_update reducer. Unknown URLs throw. */
export function fakeNetwork(w: { cfg: PagerConfig; members: MemberRow[]; pages: PageRow[] }): Recorder {
  const r: Recorder = { fetch: undefined as unknown as typeof fetch, twilio: [], sms: [], updates: [], failSql: false, failTwilio: false, failSms: false, failCall: false };
  r.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.startsWith('https://api.twilio.com/') && url.endsWith('/Messages.json')) {
      if (r.failTwilio || r.failSms) return new Response('{}', { status: 400 });
      const f = new URLSearchParams(body);
      r.sms.push({ to: f.get('To') ?? '', from: f.get('From') ?? '', body: f.get('Body') ?? '' });
      return new Response('{}', { status: 201 });
    }
    if (url.startsWith('https://api.twilio.com/')) {
      if (r.failTwilio || r.failCall) return new Response('{}', { status: 400 });
      const f = new URLSearchParams(body);
      r.twilio.push({ to: f.get('To') ?? '', twiml: f.get('Twiml') ?? '', callback: f.get('StatusCallback') ?? '' });
      return new Response('{}', { status: 201 });
    }
    if (url.endsWith('/sql')) {
      if (r.failSql) return new Response('no', { status: 500 });
      if (body.endsWith('pager_org_member')) {
        const cols = ['org_id', 'org_member_id', 'identity', 'sign_pub', 'ecdh_pub', 'sealed_contact', 'state'];
        const rows = w.members.map((m) => [m.orgId, Number(m.orgMemberId), m.identity, hex(m.signPub), hex(m.ecdhPub), hex(m.sealedContact), m.state]);
        return Response.json([{ schema: { elements: cols.map((c) => ({ name: { some: c } })) }, rows }]);
      }
      const cols = ['page_id', 'incident_id', 'org_member_id', 'status', 'requested_by'];
      const rows = w.pages.map((p) => [p.pageId, p.incidentId, Number(p.orgMemberId), p.status, p.requestedBy]);
      return Response.json([{ schema: { elements: cols.map((c) => ({ name: { some: c } })) }, rows }]);
    }
    if (url.endsWith('/call/pager_update')) {
      const [pageId, orgMemberId, status] = JSON.parse(body) as [string, number, string];
      r.updates.push({ pageId, orgMemberId: String(orgMemberId), status });
      return new Response('', { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return r;
}
