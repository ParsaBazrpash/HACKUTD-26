import { loadPagerConfig } from '@/lib/pager/config';
import { handleVoice } from '@/lib/pager/voice';

// Node.js is the default runtime here. Cache Components rejects the `runtime` segment export, so none is set.

/** POST /api/twilio/voice: Twilio's gather digit and call status webhook. Checked before anything changes. */
export async function POST(request: Request): Promise<Response> {
  const search = new URL(request.url).search;
  const raw = await request.text();
  const r = await handleVoice(loadPagerConfig(), fetch, search, raw, request.headers.get('x-twilio-signature'));
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.contentType, 'Cache-Control': 'no-store' } });
}
