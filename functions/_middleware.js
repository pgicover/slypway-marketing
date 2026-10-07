// Visitor alert (Craig, 2026-10-06). For each real page view of this site, tell
// the Slypway API so it can email admin@slypway.com. Fire and forget: the page
// is returned first, the notice runs afterwards through waitUntil, and any
// failure is swallowed. Does nothing unless VISIT_NOTIFY_SECRET is set, so
// preview deployments (which never get the secret) stay silent.
//
// Same file lives in the app repo at dashboard/functions/_middleware.js with
// SITE = 'app'. Keep the two in step.
const SITE = 'marketing';
const DEFAULT_URL = 'https://api.slypway.com/api/visits/notify/';
const ASSET_RE = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|json|txt|xml|webmanifest|pdf|mp4|webm|mp3)$/i;

function isPageView(request, response) {
  if (request.method !== 'GET') return false;
  const accept = request.headers.get('Accept') || '';
  if (!accept.includes('text/html')) return false;
  const purpose = `${request.headers.get('Purpose') || ''} ${request.headers.get('Sec-Purpose') || ''} ${request.headers.get('X-Moz') || ''}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  const dest = request.headers.get('Sec-Fetch-Dest');
  if (dest && dest !== 'document') return false;
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/api/') || ASSET_RE.test(pathname)) return false;
  if (response) {
    if (response.status < 200 || response.status >= 300) return false;
    if (!(response.headers.get('Content-Type') || '').includes('text/html')) return false;
  }
  return true;
}

function buildEvent(request) {
  const cf = request.cf || {};
  const url = new URL(request.url);
  return {
    site: SITE,
    path: url.pathname + url.search.slice(0, 200),
    referrer: request.headers.get('Referer') || '',
    user_agent: request.headers.get('User-Agent') || '',
    country: cf.country || '',
    region: cf.region || '',
    city: cf.city || '',
    verified_bot: Boolean(cf.botManagement && cf.botManagement.verifiedBot),
    time: new Date().toISOString(),
    ip: request.headers.get('CF-Connecting-IP') || '',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const response = await context.next();
  try {
    if (env.VISIT_NOTIFY_SECRET && isPageView(request, response)) {
      const send = fetch(env.VISIT_NOTIFY_URL || DEFAULT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Visit-Secret': env.VISIT_NOTIFY_SECRET },
        body: JSON.stringify(buildEvent(request)),
      }).catch(() => {});
      context.waitUntil(send);
    }
  } catch (e) {
    // Never let alerting touch the page.
  }
  return response;
}
