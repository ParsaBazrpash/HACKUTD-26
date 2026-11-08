import { describe, expect, it, vi } from 'vitest';
import { handleSms, newSeenMessages } from './sms';
import { SMS_ACK, SMS_HINT, SMS_RETRY, twilioSignature } from './twilio';
import { buildWorld, fakeNetwork, BASE, NOW, PHONES, COMMANDER_PHONE, type World } from './testkit';

vi.mock('server-only', () => ({}));

const PATH = `${BASE}/api/twilio/sms`;
let counter = 0;

interface Opts {
  from?: string;
  to?: string;
  body?: string;
  sid?: string;
  sig?: 'good' | 'bad' | 'none';
  tokenForSig?: string;
  seen?: Map<string, number>;
  failSql?: boolean;
  cfg?: World['cfg'] | null;
}

async function inbound(w: World, o: Opts = {}) {
  const net = fakeNetwork(w);
  net.failSql = o.failSql ?? false;
  const params: [string, string][] = [
    ['MessageSid', o.sid ?? `SM${String(++counter).padStart(32, '0')}`],
    ['From', o.from ?? PHONES[0]],
    ['To', o.to ?? w.cfg.twilioFrom],
    ['Body', o.body ?? '4'],
    ['NumMedia', '0'],
  ];
  const signed = await twilioSignature(o.tokenForSig ?? w.cfg.twilioToken, PATH, params);
  const sig = o.sig === 'none' ? null : o.sig === 'bad' ? 'AAAA' + signed.slice(4) : signed;
  const raw = new URLSearchParams(params).toString();
  const res = await handleSms('', raw, sig, {
    cfg: o.cfg === undefined ? w.cfg : o.cfg,
    fetch: net.fetch,
    now: () => NOW,
    seen: o.seen ?? newSeenMessages(),
  });
  return { net, res };
}

const silent = (r: Awaited<ReturnType<typeof inbound>>) => {
  expect(r.res.status).toBe(200);
  expect(r.res.body).not.toContain('<Message>');
  expect(r.net.updates).toHaveLength(0);
};

// The page rows start as 'requested' (set by request_page); /api/page writes 'calling' once it has sent the page.
async function sentWorld(): Promise<World> {
  const w = await buildWorld();
  for (const p of w.pages) p.status = 'calling';
  return w;
}

describe('POST /api/twilio/sms logic', () => {
  it('never acknowledges a page that was only requested (refused by /api/page, nothing sent)', async () => {
    const w = await buildWorld();
    expect(w.pages.every((p) => p.status === 'requested')).toBe(true);
    silent(await inbound(w, { from: PHONES[0] }));
  });

  it('a reply of 4 from a paged number acknowledges that page and answers with the acknowledgement', async () => {
    const w = await sentWorld();
    const r = await inbound(w, { from: PHONES[1] });
    const person = w.people[1];
    expect(r.net.updates).toEqual([{ pageId: w.pageId, orgMemberId: person.orgMemberId, status: 'acknowledged' }]);
    expect(r.res.status).toBe(200);
    expect(r.res.contentType).toContain('text/xml');
    expect(r.res.body).toContain(`<Message>${SMS_ACK}</Message>`);
  });

  it('works for pages that are calling or ringing', async () => {
    for (const status of ['calling', 'ringing']) {
      const w = await sentWorld();
      for (const p of w.pages) p.status = status;
      const r = await inbound(w, { from: PHONES[0] });
      expect(r.net.updates).toHaveLength(1);
    }
  });

  it('tolerates spaces around the 4 but accepts nothing else as an acknowledgement', async () => {
    const w = await sentWorld();
    expect((await inbound(w, { body: ' 4\n' })).net.updates).toHaveLength(1);
    for (const body of ['44', '4 please', 'four', 'yes', '04', '4.', '5', '']) {
      const r = await inbound(w, { body });
      expect(r.net.updates, body).toHaveLength(0);
    }
  });

  it('any other reply from a paged number gets the hint and changes nothing', async () => {
    const w = await sentWorld();
    const r = await inbound(w, { body: 'what is this?' });
    expect(r.net.updates).toHaveLength(0);
    expect(r.res.body).toContain(`<Message>${SMS_HINT}</Message>`);
  });

  it('a number that is not paged gets nothing back and changes nothing', async () => {
    const w = await sentWorld();
    silent(await inbound(w, { from: '+15557776666' }));
    silent(await inbound(w, { from: '+15557776666', body: 'hello' }));
  });

  it("an enrolled number whose page is not open can not acknowledge (the commander's own number, terminal rows)", async () => {
    const w = await sentWorld();
    silent(await inbound(w, { from: COMMANDER_PHONE }));
    for (const status of ['acknowledged', 'no_answer', 'busy', 'failed']) {
      const x = await sentWorld();
      for (const p of x.pages) p.status = status;
      silent(await inbound(x, { from: PHONES[0] }));
    }
  });

  it('one person cannot acknowledge for another: only the sender\'s own page row is written', async () => {
    const w = await sentWorld();
    const r = await inbound(w, { from: PHONES[2] });
    expect(r.net.updates).toEqual([{ pageId: w.pageId, orgMemberId: w.people[2].orgMemberId, status: 'acknowledged' }]);
  });

  it('a member who is no longer active can not acknowledge', async () => {
    const w = await sentWorld();
    w.members.find((m) => m.orgMemberId === w.people[0].orgMemberId)!.state = 'revoked';
    silent(await inbound(w, { from: PHONES[0] }));
  });

  it('a replayed text (same MessageSid) is ignored the second time', async () => {
    const w = await sentWorld();
    const seen = newSeenMessages();
    const a = await inbound(w, { sid: 'SM' + 'a'.repeat(32), seen });
    expect(a.net.updates).toHaveLength(1);
    const b = await inbound(w, { sid: 'SM' + 'a'.repeat(32), seen });
    silent(b);
  });

  it('a replay after the page is acknowledged is a quiet no-op', async () => {
    const w = await sentWorld();
    const first = await inbound(w);
    expect(first.net.updates).toHaveLength(1);
    for (const p of w.pages) p.status = 'acknowledged';
    silent(await inbound(w));
  });

  it.each(['STOP', 'stop', ' Stop ', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'START', 'YES', 'HELP', 'INFO'])('%s changes nothing and sends nothing', async (body) => {
    const w = await sentWorld();
    silent(await inbound(w, { body }));
  });

  it('refuses a wrong, missing, or foreign-token signature before reading anything', async () => {
    const w = await sentWorld();
    for (const o of [{ sig: 'bad' }, { sig: 'none' }, { tokenForSig: 'not-the-token' }] as Opts[]) {
      const r = await inbound(w, o);
      expect(r.res.status).toBe(403);
      expect(r.res.body).toBe('');
      expect(r.net.updates).toHaveLength(0);
    }
  });

  it('a signature over another URL (a different path or origin) is refused', async () => {
    const w = await sentWorld();
    const net = fakeNetwork(w);
    const params: [string, string][] = [['From', PHONES[0]], ['To', w.cfg.twilioFrom], ['Body', '4'], ['MessageSid', 'SM' + 'b'.repeat(32)]];
    for (const url of [`${BASE}/api/twilio/voice`, `https://evil.example.com/api/twilio/sms`, `${PATH}?x=1`]) {
      const sig = await twilioSignature(w.cfg.twilioToken, url, params);
      const res = await handleSms('', new URLSearchParams(params).toString(), sig, { cfg: w.cfg, fetch: net.fetch, now: () => NOW, seen: newSeenMessages() });
      expect(res.status).toBe(403);
    }
    expect(net.updates).toHaveLength(0);
  });

  it('a tampered body fails the signature', async () => {
    const w = await sentWorld();
    const net = fakeNetwork(w);
    const good: [string, string][] = [['From', '+15557776666'], ['To', w.cfg.twilioFrom], ['Body', 'hi'], ['MessageSid', 'SM' + 'c'.repeat(32)]];
    const sig = await twilioSignature(w.cfg.twilioToken, PATH, good);
    const forged = new URLSearchParams([['From', PHONES[0]], ['To', w.cfg.twilioFrom], ['Body', '4'], ['MessageSid', 'SM' + 'c'.repeat(32)]]).toString();
    const res = await handleSms('', forged, sig, { cfg: w.cfg, fetch: net.fetch, now: () => NOW, seen: newSeenMessages() });
    expect(res.status).toBe(403);
    expect(net.updates).toHaveLength(0);
  });

  it('ignores texts addressed to some other number or from a malformed sender', async () => {
    const w = await sentWorld();
    silent(await inbound(w, { to: '+15558889999' }));
    silent(await inbound(w, { from: 'whatsapp:+15551110001' }));
    silent(await inbound(w, { from: '12345' }));
    silent(await inbound(w, { from: w.cfg.twilioFrom }));
  });

  it('fails closed: no config, oversized body, unreadable Spacetime', async () => {
    const w = await sentWorld();
    expect((await inbound(w, { cfg: null })).res.status).toBe(503);
    const down = await inbound(w, { failSql: true });
    expect(down.res.status).toBe(503);
    expect(down.net.updates).toHaveLength(0);
    const net = fakeNetwork(w);
    const big = await handleSms('', 'Body=' + 'x'.repeat(20_000), 'x', { cfg: w.cfg, fetch: net.fetch, now: () => NOW, seen: newSeenMessages() });
    expect(big.status).toBe(413);
  });

  it('honest failure when the acknowledgement could not be written', async () => {
    const w = await sentWorld();
    const net = fakeNetwork(w);
    const inner = net.fetch;
    const failing = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/call/pager_update') ? Promise.resolve(new Response('no', { status: 400 })) : inner(input, init)) as typeof fetch;
    const params: [string, string][] = [['From', PHONES[0]], ['To', w.cfg.twilioFrom], ['Body', '4'], ['MessageSid', 'SM' + 'd'.repeat(32)]];
    const sig = await twilioSignature(w.cfg.twilioToken, PATH, params);
    const res = await handleSms('', new URLSearchParams(params).toString(), sig, { cfg: w.cfg, fetch: failing, now: () => NOW, seen: newSeenMessages() });
    expect(res.body).toContain(`<Message>${SMS_RETRY}</Message>`);
  });

  it('never echoes a number, a name or an id in any reply', async () => {
    const w = await sentWorld();
    for (const body of ['4', 'hello']) {
      const r = await inbound(w, { body });
      for (const s of [...PHONES, COMMANDER_PHONE, w.pageId, 'Dana', 'Casey']) expect(r.res.body).not.toContain(s);
    }
  });
});
