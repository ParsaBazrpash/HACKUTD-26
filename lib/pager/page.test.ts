import { describe, expect, it, vi } from 'vitest';
import { b64urlEncode } from '@/lib/crypto/b64url';
import { sealContact } from '@/lib/crypto/org';
import { newSeenPages, handlePage, PAGE_MAX_SKEW_MS } from './page';
import { SPOKEN_PROMPT, SPOKEN_GOODBYE, SMS_PAGE_BODY } from './twilio';
import { buildWorld, certify, fakeNetwork, INCIDENT_ID, NOW, ORG_ID, PHONES, COMMANDER_PHONE, type World } from './testkit';
import { generateDeviceKeys } from '@/lib/crypto/keys';

vi.mock('server-only', () => ({}));

async function run(w: World, mutate?: (body: World['body']) => void, opts: { now?: number; seen?: Map<string, number>; cfg?: World['cfg'] | null } = {}) {
  const net = fakeNetwork(w);
  const body = structuredClone(w.body);
  mutate?.(body);
  const result = await handlePage(JSON.stringify(body), {
    cfg: opts.cfg === undefined ? w.cfg : opts.cfg,
    fetch: net.fetch,
    now: () => opts.now ?? NOW,
    seen: opts.seen ?? newSeenPages(),
  });
  return { net, result };
}

const refused = (r: Awaited<ReturnType<typeof run>>, error: string) => {
  expect(r.result.body).toEqual({ ok: false, error });
  expect(r.net.twilio).toHaveLength(0);
  expect(r.net.updates).toHaveLength(0);
};

describe('POST /api/page logic', () => {
  it('dials each certified target once and writes calling', async () => {
    const w = await buildWorld();
    const r = await run(w);
    expect(r.result).toEqual({ status: 200, body: { ok: true, dialed: 3, failed: 0, texted: 3 } });
    expect(r.net.twilio.map((c) => c.to).sort()).toEqual([...PHONES].sort());
    expect(r.net.updates.map((u) => u.status)).toEqual(['calling', 'calling', 'calling']);
    const c = r.net.twilio[0];
    expect(c.twiml).toContain(`<Say>${SPOKEN_PROMPT}</Say>`);
    expect(c.twiml).toContain(`<Say>${SPOKEN_GOODBYE}</Say>`);
    expect(c.twiml).toContain('numDigits="1" timeout="10"');
    expect(c.callback).toMatch(/^https:\/\/haven\.example\.com\/api\/twilio\/voice\?pageId=.+&orgMemberId=\d+&t=[\w-]{43}$/);
  });

  it('texts each target at the same time, with the same facts as the call and nothing else', async () => {
    const w = await buildWorld();
    const r = await run(w);
    expect(r.net.sms.map((m) => m.to).sort()).toEqual([...PHONES].sort());
    for (const m of r.net.sms) {
      expect(m.from).toBe(w.cfg.twilioFrom);
      expect(m.body).toBe(SMS_PAGE_BODY);
      expect(m.body).toContain('Reply 4');
      expect(m.body).toContain('STOP');
      expect(m.body).not.toMatch(/https?:|\d{6}|Casey|Dana|Tom|Ravi/);
      expect(m.body).not.toContain(INCIDENT_ID);
      expect(m.body).not.toContain(w.pageId);
      expect(m.body).not.toContain(ORG_ID);
    }
  });

  it('a refused page sends no text', async () => {
    const w = await buildWorld();
    const r = await run(w, (b) => {
      b.sentAt = NOW + 10 * 60_000;
    });
    expect(r.net.sms).toHaveLength(0);
  });

  it('keeps the page open as calling when only the call fails (the text can still be answered)', async () => {
    const w = await buildWorld();
    const net = fakeNetwork(w);
    net.failCall = true;
    const result = await handlePage(JSON.stringify(w.body), { cfg: w.cfg, fetch: net.fetch, now: () => NOW, seen: newSeenPages() });
    expect(result.body).toEqual({ ok: true, dialed: 3, failed: 0, texted: 3 });
    expect(net.updates.map((u) => u.status)).toEqual(['calling', 'calling', 'calling']);
  });

  it('keeps the page open as calling when only the text fails', async () => {
    const w = await buildWorld();
    const net = fakeNetwork(w);
    net.failSms = true;
    const result = await handlePage(JSON.stringify(w.body), { cfg: w.cfg, fetch: net.fetch, now: () => NOW, seen: newSeenPages() });
    expect(result.body).toEqual({ ok: true, dialed: 3, failed: 0, texted: 0 });
    expect(net.updates.map((u) => u.status)).toEqual(['calling', 'calling', 'calling']);
  });

  it('never puts a phone number in the response', async () => {
    const w = await buildWorld();
    const r = await run(w);
    const text = JSON.stringify(r.result);
    for (const p of [...PHONES, COMMANDER_PHONE]) expect(text).not.toContain(p);
  });

  it('refuses everything when the deploy is not configured', async () => {
    const w = await buildWorld();
    refused(await run(w, undefined, { cfg: null }), 'unavailable');
  });

  it('refuses a bad body, an unknown field and an oversized body without dialing', async () => {
    const w = await buildWorld();
    const net = fakeNetwork(w);
    const deps = { cfg: w.cfg, fetch: net.fetch, now: () => NOW, seen: newSeenPages() };
    expect((await handlePage('not json', deps)).body).toEqual({ ok: false, error: 'bad_body' });
    expect((await handlePage(JSON.stringify({ ...w.body, extra: 1 }), deps)).body).toEqual({ ok: false, error: 'bad_body' });
    expect((await handlePage(' '.repeat(20_000) + JSON.stringify(w.body), deps)).body).toEqual({ ok: false, error: 'bad_body' });
    expect(net.twilio).toHaveLength(0);
  });

  it('refuses a sealed contact that is not exactly 109 bytes', async () => {
    const w = await buildWorld();
    refused(
      await run(w, (b) => {
        b.targets[0].sealedContact = b64urlEncode(new Uint8Array(110));
      }),
      'bad_body',
    );
  });

  it('refuses an admin key that is not in the pin list, even with a valid self-consistent request', async () => {
    const w = await buildWorld();
    const other = await generateDeviceKeys();
    refused(await run(w, undefined, { cfg: { ...w.cfg, adminPins: [other.signPub] } }), 'untrusted_admin');
  });

  it('refuses a request certified by a different admin than the one it names', async () => {
    const w = await buildWorld();
    const rogue = await generateDeviceKeys();
    refused(
      await run(w, (b) => {
        b.adminSignPub = b64urlEncode(rogue.signPub);
      }),
      'untrusted_admin',
    );
  });

  it('accepts any key in a multi-key pin list', async () => {
    const w = await buildWorld();
    const rogue = await generateDeviceKeys();
    const r = await run(w, undefined, { cfg: { ...w.cfg, adminPins: [rogue.signPub, w.adminKeys.signPub] } });
    expect(r.result.status).toBe(200);
  });

  it('refuses an uncertified number: a swapped sealed contact fails the admin certificate', async () => {
    const w = await buildWorld();
    const evil = await sealContact(w.pagerPub, ORG_ID, w.people[0].identity, '+15557778888');
    refused(
      await run(w, (b) => {
        b.targets[0].sealedContact = b64urlEncode(evil);
      }),
      'bad_certificate',
    );
  });

  it('refuses a certificate signed by someone other than the pinned admin', async () => {
    const w = await buildWorld();
    const rogue = await generateDeviceKeys();
    const sig = await certify(rogue, w.people[1]);
    refused(
      await run(w, (b) => {
        b.targets[1].enrollSig = sig;
      }),
      'bad_certificate',
    );
  });

  it('refuses an edited target list: swapping which id belongs to which identity breaks the commander signature', async () => {
    const w = await buildWorld();
    refused(
      await run(w, (b) => {
        const [a, c] = [b.targets[0].orgMemberId, b.targets[1].orgMemberId];
        b.targets[0].orgMemberId = c;
        b.targets[1].orgMemberId = a;
      }),
      'bad_signature',
    );
  });

  it('refuses a target dropped from or added to the signed list', async () => {
    const w = await buildWorld();
    refused(await run(w, (b) => void b.targets.pop()), 'bad_signature');
  });

  it('refuses a page whose commander signature is from another key', async () => {
    const w = await buildWorld();
    const other = await generateDeviceKeys();
    const { signPageRequest } = await import('@/lib/crypto/org');
    const sig = await signPageRequest(other.signPriv, {
      orgId: ORG_ID,
      incidentId: w.body.incidentId,
      pageId: w.pageId,
      sentAtMs: NOW,
      targets: w.people.map((p) => ({ orgMemberId: BigInt(p.orgMemberId), identityHex: p.identity })),
    });
    refused(await run(w, (b) => void (b.commanderSig = b64urlEncode(sig))), 'bad_signature');
  });

  it('refuses a stale or future request', async () => {
    const w = await buildWorld();
    refused(await run(w, undefined, { now: NOW + PAGE_MAX_SKEW_MS + 1 }), 'stale');
    refused(await run(w, undefined, { now: NOW - PAGE_MAX_SKEW_MS - 1 }), 'stale');
    expect((await run(w, undefined, { now: NOW + PAGE_MAX_SKEW_MS })).result.status).toBe(200);
  });

  it('refuses a repeated pageId in the same instance and dials only once', async () => {
    const w = await buildWorld();
    const seen = newSeenPages();
    const first = await run(w, undefined, { seen });
    expect(first.net.twilio).toHaveLength(3);
    refused(await run(w, undefined, { seen }), 'replay');
  });

  it('does not burn a pageId on a request that fails verification', async () => {
    const w = await buildWorld();
    const seen = newSeenPages();
    refused(await run(w, (b) => void (b.commanderSig = b.commanderSig.slice(0, -2) + 'AA'), { seen }), 'bad_signature');
    expect(seen.has(w.pageId)).toBe(false);
    expect((await run(w, undefined, { seen })).result.status).toBe(200);
  });

  it('refuses when a target was revoked in Spacetime', async () => {
    const w = await buildWorld();
    w.members[2].state = 'revoked';
    refused(await run(w), 'state_mismatch');
  });

  it('refuses when the commander is not active in Spacetime', async () => {
    const w = await buildWorld();
    w.members[0].state = 'revoked';
    refused(await run(w), 'state_mismatch');
  });

  it('refuses when Spacetime holds a different key or sealed contact than the request', async () => {
    const w = await buildWorld();
    w.members[1].sealedContact = new Uint8Array(w.members[1].sealedContact.map((b) => b ^ 1));
    refused(await run(w), 'state_mismatch');
    const w2 = await buildWorld();
    w2.members[1].signPub = (await generateDeviceKeys()).signPub;
    refused(await run(w2), 'state_mismatch');
  });

  it('refuses when there is no requested page row for a target, or it was already started', async () => {
    const w = await buildWorld();
    w.pages.pop();
    refused(await run(w), 'state_mismatch');
    const w2 = await buildWorld();
    w2.pages[0].status = 'calling';
    refused(await run(w2), 'state_mismatch');
  });

  it('refuses a page row requested by someone else or for another incident', async () => {
    const w = await buildWorld();
    w.pages[0].requestedBy = 'ee'.repeat(32);
    refused(await run(w), 'state_mismatch');
    const w2 = await buildWorld();
    w2.pages[0].incidentId = '99999999-9999-4999-8999-999999999999';
    refused(await run(w2), 'state_mismatch');
  });

  it('refuses when a target is not in the module row set at all', async () => {
    const w = await buildWorld();
    w.members.splice(3, 1);
    refused(await run(w), 'state_mismatch');
  });

  it('refuses when Spacetime cannot be read', async () => {
    const w = await buildWorld();
    const net = fakeNetwork(w);
    net.failSql = true;
    const result = await handlePage(JSON.stringify(w.body), { cfg: w.cfg, fetch: net.fetch, now: () => NOW, seen: newSeenPages() });
    expect(result.body).toEqual({ ok: false, error: 'unavailable' });
    expect(net.twilio).toHaveLength(0);
  });

  it('treats a contact sealed to a different pager key as malformed and dials nobody', async () => {
    const w = await buildWorld();
    const other = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const otherPub = new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey));
    const p = w.people[2];
    p.sealed = await sealContact(otherPub, ORG_ID, p.identity, '+15553334444');
    w.members[3].sealedContact = p.sealed;
    w.body.targets[2].sealedContact = b64urlEncode(p.sealed);
    w.body.targets[2].enrollSig = await certify(w.adminKeys, p);
    refused(await run(w), 'malformed_contact');
  });

  it('enforces the optional allowlist for the whole request', async () => {
    const w = await buildWorld();
    refused(await run(w, undefined, { cfg: { ...w.cfg, allowedNumbers: new Set([PHONES[0], PHONES[1]]) } }), 'not_allowed');
    const ok = await run(w, undefined, { cfg: { ...w.cfg, allowedNumbers: new Set(PHONES) } });
    expect(ok.result.status).toBe(200);
  });

  it('records failed when Twilio refuses and reports counts only', async () => {
    const w = await buildWorld();
    const net = fakeNetwork(w);
    net.failTwilio = true;
    const result = await handlePage(JSON.stringify(w.body), { cfg: w.cfg, fetch: net.fetch, now: () => NOW, seen: newSeenPages() });
    expect(result.body).toEqual({ ok: true, dialed: 0, failed: 3, texted: 0 });
    expect(net.updates.map((u) => u.status)).toEqual(['failed', 'failed', 'failed']);
  });
});
