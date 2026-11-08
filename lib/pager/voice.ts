import 'server-only';

import type { PagerConfig } from './config';
import { pagerUpdate, type PageStatus } from './spacetime';
import { EMPTY_TWIML, ackTwiml, goodbyeTwiml, reprompt, verifyBindingTag, verifyTwilioSignature, webhookUrl } from './twilio';

const MAX_VOICE_BODY = 16_384;

export interface VoiceResult {
  status: number;
  body: string;
  contentType: 'text/xml; charset=utf-8' | 'text/plain; charset=utf-8';
}

const xml = (body: string, status = 200): VoiceResult => ({ status, body, contentType: 'text/xml; charset=utf-8' });
const deny = (status: number): VoiceResult => ({ status, body: '', contentType: 'text/plain; charset=utf-8' });

const STATUS_MAP: Record<string, PageStatus> = {
  ringing: 'ringing',
  'no-answer': 'no_answer',
  busy: 'busy',
  failed: 'failed',
  canceled: 'failed',
};

/**
 * Twilio webhook (gather digit and call status). The signature and the `t` tag are checked before anything
 * else is read or changed. `search` is the request's query string, `rawBody` its form body.
 */
export async function handleVoice(
  cfg: PagerConfig | null,
  doFetch: typeof fetch,
  search: string,
  rawBody: string,
  signature: string | null,
): Promise<VoiceResult> {
  if (!cfg) return deny(503);
  if (rawBody.length > MAX_VOICE_BODY) return deny(413);
  const params = [...new URLSearchParams(rawBody).entries()] as [string, string][];
  // Exact public URL: the configured production origin plus the path and query we were called with.
  const url = `${cfg.publicBaseUrl}/api/twilio/voice${search.startsWith('?') ? search : search ? `?${search}` : ''}`;
  if (!(await verifyTwilioSignature(cfg.twilioToken, url, params, signature))) return deny(403);
  const q = new URLSearchParams(search);
  const pageId = q.get('pageId') ?? '';
  const orgMemberId = q.get('orgMemberId') ?? '';
  if (!(await verifyBindingTag(cfg.twilioToken, pageId, orgMemberId, q.get('t') ?? ''))) return deny(403);

  const digits = params.find(([k]) => k === 'Digits')?.[1];
  if (digits !== undefined) {
    if (digits === '4') {
      await pagerUpdate(cfg, doFetch, pageId, orgMemberId, 'acknowledged');
      return xml(ackTwiml());
    }
    if (q.get('r') === '1') return xml(goodbyeTwiml());
    return xml(reprompt(await webhookUrl(cfg, pageId, orgMemberId, { r: '1' })));
  }

  const callStatus = params.find(([k]) => k === 'CallStatus')?.[1] ?? '';
  const next = STATUS_MAP[callStatus];
  if (next) await pagerUpdate(cfg, doFetch, pageId, orgMemberId, next);
  return xml(EMPTY_TWIML);
}
