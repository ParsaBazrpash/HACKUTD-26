import { loadPagerConfig } from '@/lib/pager/config';
import { handleSms, newSeenMessages } from '@/lib/pager/sms';

// Node.js is the default runtime here. Cache Components rejects the `runtime` segment export, so none is set.
const seen = newSeenMessages();

/** POST /api/twilio/sms: Twilio's inbound text webhook. A reply of 4 acknowledges the sender's open page. Checked before anything changes. */
export async function POST(request: Request): Promise<Response> {
  const search = new URL(request.url).search;
  const raw = await request.text();
  const r = await handleSms(search, raw, request.headers.get('x-twilio-signature'), { cfg: loadPagerConfig(), fetch, now: Date.now, seen });
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.contentType, 'Cache-Control': 'no-store' } });
}
