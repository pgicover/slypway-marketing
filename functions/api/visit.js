// Visitor alert beacon receiver (Craig, 2026-10-07). The page script
// (/assets/visit.js) posts {page, referrer} here after the page has loaded in
// a visible, non-automated browser. This function adds what only the edge
// knows (IP, user agent, location, network, verified-bot flag) and forwards it
// to the Slypway API, which applies the owner, bot, datacenter, bot-path and
// 90-day rules and sends the email. Fire and forget: always answers 204.
// Does nothing unless VISIT_NOTIFY_SECRET is set, so preview deployments
// (which never get the secret) stay silent.
//
// Same file lives in the other repo; only SITE differs. Keep the two in step.
const SITE = 'marketing';
const DEFAULT_URL = 'https://api.slypway.com/api/visits/notify/';
const MAX_BODY = 2048;
const LIMIT = 10; // posts per IP per minute, per isolate (best effort, free tier)
const WINDOW_MS = 60 * 1000;
const hits = new Map();

function limited(ip, now) {
  if (hits.size > 5000) hits.clear();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT;
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch (e) {
    return false;
  }
}

export function buildEvent(request, body) {
  const cf = request.cf || {};
  const page = typeof body.page === 'string' && body.page.startsWith('/') ? body.page : '/';
  return {
    site: SITE,
    path: page.slice(0, 300),
    referrer: typeof body.referrer === 'string' ? body.referrer.slice(0, 300) : '',
    user_agent: request.headers.get('User-Agent') || '',
    country: cf.country || '',
    region: cf.region || '',
    city: cf.city || '',
    asn: cf.asn || '',
    as_organization: cf.asOrganization || '',
    verified_bot: Boolean(cf.botManagement && cf.botManagement.verifiedBot),
    time: new Date().toISOString(),
    ip: request.headers.get('CF-Connecting-IP') || '',
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const done = new Response(null, { status: 204 });
  try {
    if (!env.VISIT_NOTIFY_SECRET || !sameOrigin(request)) return done;
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (limited(ip, Date.now())) return done;
    const text = await request.text();
    if (text.length > MAX_BODY) return done;
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object') return done;
    const send = fetch(env.VISIT_NOTIFY_URL || DEFAULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Visit-Secret': env.VISIT_NOTIFY_SECRET },
      body: JSON.stringify(buildEvent(request, body)),
    }).catch(() => {});
    context.waitUntil(send);
  } catch (e) {
    // Never let alerting fail loudly.
  }
  return done;
}
