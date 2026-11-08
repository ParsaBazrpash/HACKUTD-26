import 'server-only';

import { openContact } from '@/lib/crypto/org';
import { isE164 } from '@/spacetimedb/src/shared/org';
import type { PagerConfig } from './config';
import { importPagerKey } from './page';
import { pagerUpdate, readPagerState } from './spacetime';
import { EMPTY_TWIML, SMS_ACK, SMS_HINT, SMS_RETRY, smsReplyTwiml, verifyTwilioSignature } from './twilio';

const MAX_SMS_BODY = 16_384;
/** A page row is open while the module still accepts an acknowledgement. Terminal rows never change. */
const OPEN = new Set(['requested', 'calling', 'ringing']);
/** At most this many members with an open page are opened per text (the module caps pages at 20 per incident per hour). */
const MAX_CANDIDATES = 100;
/** Words Twilio handles itself for opt-out and help. We never act on them and never answer them. */
const COMPLIANCE_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'START', 'YES', 'UNSTOP', 'HELP', 'INFO']);
const SEEN_TTL_MS = 10 * 60_000;
const SEEN_MAX = 2000;

export interface SmsResult {
  status: number;
  body: string;
  contentType: 'text/xml; charset=utf-8' | 'text/plain; charset=utf-8';
}

export interface SmsDeps {
  cfg: PagerConfig | null;
  fetch: typeof fetch;
  now: () => number;
  /** MessageSid to expiry. Per server instance; acknowledging twice is harmless because rows only move forward. */
  seen: Map<string, number>;
}

export const newSeenMessages = (): Map<string, number> => new Map();

const xml = (body: string): SmsResult => ({ status: 200, body, contentType: 'text/xml; charset=utf-8' });
const empty = (): SmsResult => xml(EMPTY_TWIML);
const deny = (status: number): SmsResult => ({ status, body: '', contentType: 'text/plain; charset=utf-8' });

/**
 * Twilio inbound text webhook. The signature is checked before anything else is read. A reply of 4 acknowledges the
 * sender's open pages and nothing else does: the sender's number must match a sealed number of an active org
 * member who has a page that is still open in Spacetime. Anyone else, and every other message, gets an empty answer
 * (no text goes back), so the endpoint is no oracle for who is enrolled.
 */
export async function handleSms(search: string, rawBody: string, signature: string | null, deps: SmsDeps): Promise<SmsResult> {
  const { cfg } = deps;
  if (!cfg) return deny(503);
  if (rawBody.length > MAX_SMS_BODY) return deny(413);
  const params = [...new URLSearchParams(rawBody).entries()] as [string, string][];
  const url = `${cfg.publicBaseUrl}/api/twilio/sms${search.startsWith('?') ? search : search ? `?${search}` : ''}`;
  if (!(await verifyTwilioSignature(cfg.twilioToken, url, params, signature))) return deny(403);

  const get = (k: string): string => params.find(([n]) => n === k)?.[1] ?? '';
  const from = get('From');
  const sid = get('MessageSid');
  // Only texts sent to our own number, from a real E.164 number. Group, WhatsApp and short-code shapes fall out here.
  if (get('To') !== cfg.twilioFrom || !isE164(from) || from === cfg.twilioFrom) return empty();

  const word = get('Body').trim();
  if (COMPLIANCE_WORDS.has(word.toUpperCase())) return empty();

  const state = await readPagerState(cfg, deps.fetch);
  if (!state) return deny(503);
  const open = state.pages.filter((p) => OPEN.has(p.status));
  if (open.length === 0) return empty();

  const key = await importPagerKey(cfg.pagerPrivateKey);
  if (!key) return deny(503);
  const candidates = state.members.filter((m) => m.state === 'active' && open.some((p) => p.orgMemberId === m.orgMemberId));
  if (candidates.length > MAX_CANDIDATES) return empty();
  const mine: typeof candidates = [];
  for (const m of candidates) {
    const number = await openContact(key, m.orgId, m.identity, m.sealedContact);
    if (number !== null && number === from) mine.push(m);
  }
  if (mine.length === 0) return empty();

  if (word !== '4') return xml(smsReplyTwiml(SMS_HINT));

  // Retried or replayed delivery of the same text: do nothing twice. Recorded only for matched senders, so
  // outside texts to our number cannot fill the map.
  const now = deps.now();
  for (const [k, exp] of deps.seen) if (exp <= now) deps.seen.delete(k);
  if (sid.length > 0) {
    if (deps.seen.has(sid)) return empty();
    if (deps.seen.size >= SEEN_MAX) deps.seen.delete(deps.seen.keys().next().value as string);
    deps.seen.set(sid, now + SEEN_TTL_MS);
  }

  let recorded = 0;
  let failed = 0;
  for (const m of mine) {
    for (const p of open.filter((x) => x.orgMemberId === m.orgMemberId)) {
      if (await pagerUpdate(cfg, deps.fetch, p.pageId, m.orgMemberId, 'acknowledged')) recorded++;
      else failed++;
    }
  }
  return xml(smsReplyTwiml(recorded > 0 || failed === 0 ? SMS_ACK : SMS_RETRY));
}

