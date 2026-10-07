// Run: node --test scripts/visit-beacon.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { onRequestPost, buildEvent } from '../functions/api/visit.js';

const source = readFileSync(new URL('../assets/visit.js', import.meta.url), 'utf8');

// Run the beacon in a fake browser. Fires the load event and jumps the timer.
function runBeacon({ hidden = false, webdriver = false, saveData = false, stored = null, storageThrows = false, path = '/pricing', referrer = 'https://g.co/' } = {}) {
  const fetched = [];
  const timers = [];
  let loadHandler;
  const store = new Map(stored ? [['sw_v', stored]] : []);
  const sessionStorage = storageThrows
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const sandbox = {
    document: { hidden, referrer },
    navigator: { webdriver, connection: { saveData } },
    location: { pathname: path },
    sessionStorage,
    addEventListener: (type, fn) => { if (type === 'load') loadHandler = fn; },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    fetch: (url, init) => { fetched.push({ url, init }); return Promise.resolve(); },
    JSON,
  };
  vm.runInNewContext(source, sandbox);
  loadHandler();
  assert.equal(timers[0].ms, 2000);
  timers[0].fn();
  return { fetched, store };
}

test('beacon is under 1 KB and uses no third party or cookie', () => {
  assert.ok(Buffer.byteLength(source) < 1024);
  assert.ok(!/cookie|https?:\/\//.test(source));
});

test('visible, non-automated browser posts page and referrer once', () => {
  const { fetched, store } = runBeacon();
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, '/api/visit');
  assert.deepEqual(JSON.parse(fetched[0].init.body), { page: '/pricing', referrer: 'https://g.co/' });
  assert.equal(store.get('sw_v'), '1');
});

test('hidden tab, webdriver, save-data and already-sent session send nothing', () => {
  assert.equal(runBeacon({ hidden: true }).fetched.length, 0);
  assert.equal(runBeacon({ webdriver: true }).fetched.length, 0);
  assert.equal(runBeacon({ saveData: true }).fetched.length, 0);
  assert.equal(runBeacon({ stored: '1' }).fetched.length, 0);
});

test('blocked storage does not throw and still sends once for the page', () => {
  assert.equal(runBeacon({ storageThrows: true }).fetched.length, 1);
});

const env = { VISIT_NOTIFY_SECRET: 's', VISIT_NOTIFY_URL: 'http://x.test/n/' };
function post(body, { headers = {}, ip = '203.0.113.7', cf = {}, e = env, url = 'https://slypway.com/api/visit' } = {}) {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Test Browser', 'CF-Connecting-IP': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  Object.defineProperty(request, 'cf', { value: cf });
  return request;
}
async function call(request, e = env) {
  const calls = [];
  const waits = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}'); };
  try {
    const res = await onRequestPost({ request, env: e, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return { res, calls };
  } finally { globalThis.fetch = realFetch; }
}

test('function forwards edge fields with the secret', async () => {
  const cf = { country: 'CA', region: 'British Columbia', city: 'Vancouver', asn: 812, asOrganization: 'Rogers', botManagement: { verifiedBot: false } };
  const { res, calls } = await call(post({ page: '/pricing', referrer: 'https://g.co/' }, { cf }));
  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://x.test/n/');
  assert.equal(calls[0].init.headers['X-Visit-Secret'], 's');
  const b = JSON.parse(calls[0].init.body);
  assert.deepEqual(
    { site: b.site, path: b.path, referrer: b.referrer, ip: b.ip, country: b.country, city: b.city, region: b.region, asn: b.asn, as_organization: b.as_organization, verified_bot: b.verified_bot },
    { site: 'marketing', path: '/pricing', referrer: 'https://g.co/', ip: '203.0.113.7', country: 'CA', city: 'Vancouver', region: 'British Columbia', asn: 812, as_organization: 'Rogers', verified_bot: false },
  );
  assert.equal(b.user_agent, 'Mozilla/5.0 Test Browser');
});

test('verified bot flag is forwarded', () => {
  const r = post({ page: '/' }, { cf: { botManagement: { verifiedBot: true } } });
  assert.equal(buildEvent(r, { page: '/' }).verified_bot, true);
});

test('no secret, cross-site origin, bad or oversized body: silent 204', async () => {
  assert.equal((await call(post({ page: '/' }), {})).calls.length, 0);
  assert.equal((await call(post({ page: '/' }, { headers: { Origin: 'https://evil.test' } }))).calls.length, 0);
  assert.equal((await call(post('not json'))).calls.length, 0);
  assert.equal((await call(post({ page: '/' + 'a'.repeat(3000) }))).calls.length, 0);
  const ok = await call(post({ page: '/' }, { headers: { Origin: 'https://slypway.com' } }));
  assert.equal(ok.calls.length, 1);
});

test('page must be a path, long values are clipped', () => {
  assert.equal(buildEvent(post({}), { page: 'https://x.test/' }).path, '/');
  assert.equal(buildEvent(post({}), { page: '/' + 'a'.repeat(400) }).path.length, 300);
});

test('rate limit: only 10 posts a minute per address are forwarded', async () => {
  let forwarded = 0;
  for (let i = 0; i < 15; i += 1) forwarded += (await call(post({ page: '/' }, { ip: '198.51.100.9' }))).calls.length;
  assert.equal(forwarded, 10);
});

test('upstream failure never breaks the response', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('boom'); };
  try {
    const waits = [];
    const res = await onRequestPost({ request: post({ page: '/' }, { ip: '198.51.100.50' }), env, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    assert.equal(res.status, 204);
  } finally { globalThis.fetch = realFetch; }
});
