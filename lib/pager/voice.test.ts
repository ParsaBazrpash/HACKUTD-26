import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handleVoice } from './voice';
import { bindingTag, twilioSignature, SPOKEN_ACK, SPOKEN_GOODBYE, SPOKEN_PROMPT, verifyBindingTag } from './twilio';
import { buildWorld, fakeNetwork, BASE, TOKEN, type World } from './testkit';

vi.mock('server-only', () => ({}));

const PAGE = '44444444-4444-4444-8444-444444444444';
const MEMBER = '7';

async function call(w: World, opts: { params?: Record<string, string>; extra?: Record<string, string>; tag?: string; sig?: 'good' | 'bad' | 'none'; tokenForSig?: string; urlTamper?: string }) {
  const net = fakeNetwork(w);
  const t = opts.tag ?? (await bindingTag(TOKEN, PAGE, MEMBER));
  const q = new URLSearchParams({ pageId: PAGE, orgMemberId: MEMBER, t, ...opts.extra });
  const search = `?${q.toString()}`;
  const params = Object.entries(opts.params ?? {}) as [string, string][];
  const signed = await twilioSignature(opts.tokenForSig ?? TOKEN, `${BASE}/api/twilio/voice${opts.urlTamper ?? search}`, params);
  const sig = opts.sig === 'none' ? null : opts.sig === 'bad' ? 'AAAA' + signed.slice(4) : signed;
  const body = new URLSearchParams(params).toString();
  const res = await handleVoice(w.cfg, net.fetch, search, body, sig);
  return { net, res };
}

describe('Twilio signature', () => {
  it('matches the vector from Twilio documentation', async () => {
    const sig = await twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', [
      ['Digits', '1234'],
      ['To', '+18005551212'],
      ['From', '+14158675310'],
      ['Caller', '+14158675310'],
      ['CallSid', 'CA1234567890ABCDE'],
    ]);
    expect(sig).toBe('GvWf1cFY/Q7PnoempGyD5oXAezc=');
  });

  it('agrees with an independent HMAC-SHA1 over url and sorted params', async () => {
    const url = 'https://x.example/a?b=1';
    const sig = await twilioSignature('tok', url, [['b', '2'], ['a', '1']]);
    expect(sig).toBe(createHmac('sha1', 'tok').update(`${url}a1b2`).digest('base64'));
  });
});

describe('binding tag', () => {
  it('binds page and member and depends on the token', async () => {
    const t = await bindingTag(TOKEN, PAGE, MEMBER);
    expect(await verifyBindingTag(TOKEN, PAGE, MEMBER, t)).toBe(true);
    expect(await verifyBindingTag(TOKEN, PAGE, '8', t)).toBe(false);
    expect(await verifyBindingTag(TOKEN, '55555555-5555-4555-8555-555555555555', MEMBER, t)).toBe(false);
    expect(await verifyBindingTag('other-token', PAGE, MEMBER, t)).toBe(false);
    expect(await verifyBindingTag(TOKEN, PAGE, MEMBER, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(await verifyBindingTag(TOKEN, PAGE, MEMBER, '')).toBe(false);
  });
});

describe('POST /api/twilio/voice logic', () => {
  it('pressing 4 writes acknowledged and says the acknowledgement', async () => {
    const w = await buildWorld();
    const { net, res } = await call(w, { params: { Digits: '4', CallStatus: 'in-progress' } });
    expect(net.updates).toEqual([{ pageId: PAGE, orgMemberId: MEMBER, status: 'acknowledged' }]);
    expect(res.body).toContain(`<Say>${SPOKEN_ACK}</Say>`);
    expect(res.contentType).toContain('text/xml');
  });

  it('another digit re-prompts once, then says goodbye, and never acknowledges', async () => {
    const w = await buildWorld();
    const first = await call(w, { params: { Digits: '9' } });
    expect(first.res.body).toContain(`<Say>${SPOKEN_PROMPT}</Say>`);
    expect(first.res.body).toMatch(/orgMemberId=7&amp;t=[\w-]{43}&amp;r=1/);
    const second = await call(w, { params: { Digits: '9' }, extra: { r: '1' } });
    expect(second.res.body).toContain(`<Say>${SPOKEN_GOODBYE}</Say>`);
    expect(second.res.body).not.toContain('Gather');
    expect(first.net.updates).toHaveLength(0);
    expect(second.net.updates).toHaveLength(0);
  });

  it.each([
    ['ringing', 'ringing'],
    ['no-answer', 'no_answer'],
    ['busy', 'busy'],
    ['failed', 'failed'],
    ['canceled', 'failed'],
  ])('status %s writes %s', async (callStatus, expected) => {
    const w = await buildWorld();
    const { net, res } = await call(w, { params: { CallStatus: callStatus } });
    expect(net.updates).toEqual([{ pageId: PAGE, orgMemberId: MEMBER, status: expected }]);
    expect(res.body).toContain('<Response/>');
  });

  it.each(['initiated', 'in-progress', 'completed', 'queued', 'bogus'])('status %s changes nothing', async (callStatus) => {
    const w = await buildWorld();
    const { net, res } = await call(w, { params: { CallStatus: callStatus } });
    expect(net.updates).toHaveLength(0);
    expect(res.status).toBe(200);
  });

  it('a wrong or missing X-Twilio-Signature changes nothing', async () => {
    const w = await buildWorld();
    for (const sig of ['bad', 'none'] as const) {
      const { net, res } = await call(w, { params: { Digits: '4' }, sig });
      expect(res.status).toBe(403);
      expect(net.updates).toHaveLength(0);
    }
  });

  it('a signature made with another token or over another URL changes nothing', async () => {
    const w = await buildWorld();
    const a = await call(w, { params: { Digits: '4' }, tokenForSig: 'not-the-token' });
    expect(a.res.status).toBe(403);
    expect(a.net.updates).toHaveLength(0);
    const b = await call(w, { params: { Digits: '4' }, urlTamper: `?pageId=${PAGE}&orgMemberId=8&t=x` });
    expect(b.res.status).toBe(403);
    expect(b.net.updates).toHaveLength(0);
  });

  it('a wrong t tag changes nothing even with a valid Twilio signature', async () => {
    const w = await buildWorld();
    const wrong = await bindingTag(TOKEN, PAGE, '8');
    const { net, res } = await call(w, { params: { Digits: '4' }, tag: wrong });
    expect(res.status).toBe(403);
    expect(net.updates).toHaveLength(0);
  });

  it('refuses when not configured', async () => {
    const w = await buildWorld();
    const net = fakeNetwork(w);
    const res = await handleVoice(null, net.fetch, '?a=1', '', 'x');
    expect(res.status).toBe(503);
    expect(net.updates).toHaveLength(0);
  });
});
