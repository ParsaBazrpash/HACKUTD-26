import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { b64urlEncode } from '@/lib/crypto/b64url';
import { buf } from '@/lib/crypto/hash';
import { enc } from '@/spacetimedb/src/shared/encoding';
import { isUuidV4 } from '@/spacetimedb/src/shared/org';
import type { PagerConfig } from './config';

const te = new TextEncoder();

/** Spoken on every page. It asks for nothing but an optional 4 and says nothing secret. */
export const SPOKEN_PROMPT =
  'HAVEN incident page. Open HAVEN on your personal phone. HAVEN will never ask you for a code. Press 4 to acknowledge.';
export const SPOKEN_GOODBYE = 'Open HAVEN on your personal phone. Goodbye.';
export const SPOKEN_ACK = 'Acknowledged. Open HAVEN now.';

const isDecimalId = (s: string): boolean => /^(0|[1-9][0-9]{0,19})$/.test(s);

async function hmac(hash: 'SHA-256' | 'SHA-1', key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', buf(key), { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, buf(msg)));
}

const safeEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && timingSafeEqual(a, b);

/** Binding tag `t`: HMAC-SHA256 over pageId and orgMemberId, keyed by a key derived from the Twilio auth token. */
export async function bindingTag(authToken: string, pageId: string, orgMemberId: string): Promise<string> {
  const key = await hmac('SHA-256', te.encode(authToken), enc('zh1/pager/bind-key'));
  return b64urlEncode(await hmac('SHA-256', key, enc('zh1/pager/bind', pageId, orgMemberId)));
}

export async function verifyBindingTag(authToken: string, pageId: string, orgMemberId: string, tag: string): Promise<boolean> {
  try {
    if (!isUuidV4(pageId) || !isDecimalId(orgMemberId) || tag.length !== 43) return false;
    const want = te.encode(await bindingTag(authToken, pageId, orgMemberId));
    return safeEqual(want, te.encode(tag));
  } catch {
    return false;
  }
}

/** Twilio's X-Twilio-Signature: base64 HMAC-SHA1 of the exact URL plus each POST param name and value, sorted by name. */
export async function twilioSignature(authToken: string, url: string, params: readonly (readonly [string, string])[]): Promise<string> {
  const sorted = [...params].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const data = url + sorted.map(([k, v]) => k + v).join('');
  return Buffer.from(await hmac('SHA-1', te.encode(authToken), te.encode(data))).toString('base64');
}

export async function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: readonly (readonly [string, string])[],
  header: string | null,
): Promise<boolean> {
  try {
    if (!header) return false;
    const want = te.encode(await twilioSignature(authToken, url, params));
    return safeEqual(want, te.encode(header));
  } catch {
    return false;
  }
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
export const EMPTY_TWIML = `${HEAD}<Response/>`;

/** Webhook URL for one call and person. `extra` params (such as r=1) are part of the signed URL. */
export async function webhookUrl(cfg: PagerConfig, pageId: string, orgMemberId: string, extra: Record<string, string> = {}): Promise<string> {
  const t = await bindingTag(cfg.twilioToken, pageId, orgMemberId);
  const q = new URLSearchParams({ pageId, orgMemberId, t, ...extra });
  return `${cfg.publicBaseUrl}/api/twilio/voice?${q.toString()}`;
}

/** The page call: one-digit Gather whose Say is the exact prompt, then the goodbye. */
export function pageTwiml(actionUrl: string): string {
  return (
    `${HEAD}<Response>` +
    `<Gather input="dtmf" numDigits="1" timeout="10" method="POST" action="${xmlEscape(actionUrl)}">` +
    `<Say>${xmlEscape(SPOKEN_PROMPT)}</Say></Gather>` +
    `<Say>${xmlEscape(SPOKEN_GOODBYE)}</Say></Response>`
  );
}

export const ackTwiml = (): string => `${HEAD}<Response><Say>${xmlEscape(SPOKEN_ACK)}</Say></Response>`;

/** Wrong digit, first time: ask once more. The second attempt (r=1) just says goodbye. */
export const reprompt = (actionUrl: string): string => pageTwiml(actionUrl);
export const goodbyeTwiml = (): string => `${HEAD}<Response><Say>${xmlEscape(SPOKEN_GOODBYE)}</Say></Response>`;

/** Places one call through the Twilio REST API (plain fetch, Basic auth). Returns true on a 2xx answer. Never logs the number. */
export async function placeCall(cfg: PagerConfig, doFetch: typeof fetch, to: string, pageId: string, orgMemberId: string): Promise<boolean> {
  try {
    const action = await webhookUrl(cfg, pageId, orgMemberId);
    const status = await webhookUrl(cfg, pageId, orgMemberId);
    const body = new URLSearchParams();
    body.set('To', to);
    body.set('From', cfg.twilioFrom);
    body.set('Twiml', pageTwiml(action));
    body.set('Timeout', '25');
    body.set('StatusCallback', status);
    body.set('StatusCallbackMethod', 'POST');
    for (const e of ['initiated', 'ringing', 'answered', 'completed']) body.append('StatusCallbackEvent', e);
    const auth = Buffer.from(`${cfg.twilioSid}:${cfg.twilioToken}`).toString('base64');
    const res = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.twilioSid}/Calls.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
