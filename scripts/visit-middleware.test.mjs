// Run: node --test scripts/visit-middleware.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

const html = () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
const req = (url, headers = {}, method = 'GET') =>
  new Request(url, { method, headers: { Accept: 'text/html,application/xhtml+xml', ...headers } });

async function run(request, env, response = html()) {
  const calls = [];
  const waits = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}'); };
  try {
    const res = await onRequest({ request, env, next: async () => response, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return { res, calls };
  } finally { globalThis.fetch = realFetch; }
}

const env = { VISIT_NOTIFY_SECRET: 's', VISIT_NOTIFY_URL: 'http://x.test/n/' };

test('page view posts event with secret and CF IP', async () => {
  const { calls, res } = await run(req('https://slypway.com/pricing?a=1', { 'CF-Connecting-IP': '203.0.113.7', Referer: 'https://g.co/' }), env);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['X-Visit-Secret'], 's');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.site, 'marketing');
  assert.equal(body.ip, '203.0.113.7');
  assert.equal(body.path, '/pricing?a=1');
  assert.equal(body.referrer, 'https://g.co/');
});

test('skips assets, api, non-GET, non-html, prefetch, prerender, subresources', async () => {
  for (const r of [
    req('https://slypway.com/assets/app.js'),
    req('https://slypway.com/api/contact'),
    req('https://slypway.com/', {}, 'POST'),
    req('https://slypway.com/', { Accept: 'application/json' }),
    req('https://slypway.com/', { Purpose: 'prefetch' }),
    req('https://slypway.com/', { 'Sec-Purpose': 'prefetch;prerender' }),
    req('https://slypway.com/', { 'Sec-Fetch-Dest': 'iframe' }),
  ]) {
    const { calls } = await run(r, env);
    assert.equal(calls.length, 0, r.url);
  }
});

test('skips redirects and non-html responses', async () => {
  assert.equal((await run(req('https://slypway.com/'), env, new Response('', { status: 301, headers: { 'Content-Type': 'text/html' } }))).calls.length, 0);
  assert.equal((await run(req('https://slypway.com/'), env, new Response('{}', { headers: { 'Content-Type': 'application/json' } }))).calls.length, 0);
});

test('no secret means silent, and failures never break the page', async () => {
  assert.equal((await run(req('https://slypway.com/'), {})).calls.length, 0);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('boom'); };
  try {
    const waits = [];
    const res = await onRequest({ request: req('https://slypway.com/'), env, next: async () => html(), waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    assert.equal(res.status, 200);
  } finally { globalThis.fetch = realFetch; }
});
