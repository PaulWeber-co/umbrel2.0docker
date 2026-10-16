import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import photos, { baseUrl, toWidgetData } from '../server/widgets/photos.js';
import { fit, render, size } from '../web/js/widgets/fotos.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const assets = fixture('immich-assets-statistics.json');
const server = fixture('immich-server-statistics.json');
const search = fixture('immich-search.json');

const KEY = 'qW3rTy-immich-test-key-0123456789abcdef';
const NOW = new Date('2026-10-15T07:42:00+02:00');
const config = (env) => loadConfig({ argv: [], env, envFile: '/nonexistent' });

// ctx stub: answers each Immich endpoint with its fixture (or an HTTP error
// like server/hub.js throws) and records every request.
function stub({ fail = {} } = {}) {
  const calls = [];
  const answers = {
    '/api/assets/statistics': assets,
    '/api/server/statistics': server,
    '/api/search/statistics': search,
  };
  const fetchJson = async (url, options = {}) => {
    calls.push({ url, ...options });
    const path = new URL(url).pathname;
    const method = options.method ?? 'GET';
    if (fail[path]) throw new Error(`${method} ${url}: HTTP ${fail[path]}`);
    if (!answers[path]) throw new Error(`${method} ${url}: HTTP 404`);
    return structuredClone(answers[path]);
  };
  const ctx = {
    config: config({ DASH_IMMICH_URL: 'http://umbrel.local:2283/', DASH_IMMICH_KEY: KEY }),
    fetchJson,
    fetchText: async () => assert.fail('fetchText is not used'),
    now: () => NOW,
  };
  return { ctx, calls };
}

test('Immich answers become widget data', () => {
  assert.deepEqual(toWidgetData(assets, server, search), {
    images: 18432,
    videos: 1204,
    total: 19636,
    usageBytes: 103079215104,
    addedThisWeek: 37,
  });
  assert.deepEqual(toWidgetData(assets), { images: 18432, videos: 1204, total: 19636, usageBytes: null, addedThisWeek: null });
  assert.throws(() => toWidgetData({ message: 'Unauthorized' }), /unerwartete Antwort/);
});

test('fetch reads all three endpoints', async () => {
  const { ctx, calls } = stub();
  assert.deepEqual(await photos.fetch(ctx), toWidgetData(assets, server, search));
  assert.deepEqual(
    calls.map((c) => `${c.method ?? 'GET'} ${c.url}`).sort(),
    [
      'GET http://umbrel.local:2283/api/assets/statistics',
      'GET http://umbrel.local:2283/api/server/statistics',
      'POST http://umbrel.local:2283/api/search/statistics',
    ],
  );
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(post.body), { takenAfter: '2026-10-08T05:42:00.000Z' });
});

test('usage is null when server statistics answer 403 (no admin key)', async () => {
  const { ctx } = stub({ fail: { '/api/server/statistics': 403 } });
  const data = await photos.fetch(ctx);
  assert.equal(data.usageBytes, null);
  assert.equal(data.images, 18432);
  assert.equal(data.addedThisWeek, 37);
});

test('week is null when the search fails', async () => {
  const { ctx } = stub({ fail: { '/api/search/statistics': 500 } });
  const data = await photos.fetch(ctx);
  assert.equal(data.addedThisWeek, null);
  assert.equal(data.usageBytes, 103079215104);
});

test('asset statistics are required', async () => {
  const { ctx } = stub({ fail: { '/api/assets/statistics': 401 } });
  await assert.rejects(photos.fetch(ctx), /HTTP 401/);
});

test('API key goes in the x-api-key header of every request, never in the URL', async () => {
  const { ctx, calls } = stub();
  await photos.fetch(ctx);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.headers['x-api-key'], KEY);
    assert.ok(!call.url.includes(KEY), `key not in ${call.url}`);
  }
  const error = await photos.fetch(stub({ fail: { '/api/assets/statistics': 401 } }).ctx).catch((e) => e);
  assert.ok(!error.message.includes(KEY), 'key not in the error message');
});

test('settings: both URL and key are required, trailing slash is removed', async () => {
  assert.equal(photos.isConfigured(config({})), false);
  assert.equal(photos.isConfigured(config({ DASH_IMMICH_URL: 'http://umbrel.local:2283' })), false);
  assert.equal(photos.isConfigured(config({ DASH_IMMICH_KEY: KEY })), false);
  assert.equal(photos.isConfigured(config({ DASH_IMMICH_URL: 'http://umbrel.local:2283', DASH_IMMICH_KEY: KEY })), true);
  assert.equal(baseUrl('http://umbrel.local:2283//'), 'http://umbrel.local:2283');
  const { ctx } = stub();
  ctx.config = config({ DASH_IMMICH_URL: 'umbrel.local:2283', DASH_IMMICH_KEY: KEY });
  await assert.rejects(photos.fetch(ctx), /http:\/\/ oder https:\/\//);
});

test('byte sizes in German with 1024-based units', () => {
  assert.equal(size(103079215104), '96 GB');
  assert.equal(size(10 * 1024 ** 3), '10 GB');
  assert.equal(size(3.4 * 1024 ** 3), '3,4 GB');
  assert.equal(size(512 * 1024 ** 2), '0,5 GB');
  assert.equal(size(1.2 * 1024 ** 4), '1,2 TB');
  assert.equal(size(1024 ** 4), '1,0 TB');
  assert.equal(size(1023.8 * 1024 ** 3), '1,0 TB');
});

test('long counts get a smaller size class', () => {
  assert.equal(fit('1.234'), '');
  assert.equal(fit('18.432'), ' fo-l6');
  assert.equal(fit('180.432'), ' fo-l7');
  assert.equal(fit('1.180.432'), ' fo-l8');
  assert.equal(fit('18.180.432'), ' fo-l10');
});

test('tile: loading, counts, singular and the foot line', () => {
  assert.match(render(null, { compact: false }), /class="loading"/);
  const demo = photos.demo();
  const html = render(demo, { compact: false });
  assert.match(html, /class="big long fo-n fo-l6">18\.432</);
  assert.match(html, />1\.204 Videos</);
  assert.match(html, />\+37 diese Woche</);
  assert.match(render(demo, { compact: true }), /class="fo compact"/);
  assert.match(render({ ...demo, videos: 1 }, {}), />1 Video</);
  assert.match(render({ ...demo, addedThisWeek: 0 }, {}), /class="foot fo-line">96 GB</);
  assert.match(render({ ...demo, addedThisWeek: 1234 }, {}), /fo-small">\+1\.234 diese Woche</);
  const bare = render({ ...demo, addedThisWeek: null, usageBytes: null }, {});
  assert.doesNotMatch(bare, /foot/);
  assert.doesNotMatch(bare, /undefined|NaN/);
  assert.match(render({ images: 0, videos: 0, total: 0, usageBytes: null, addedThisWeek: null }, {}), />Noch leer</);
});

test('demo data has the same shape as real data', () => {
  const shape = (value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]))
      : Array.isArray(value) ? 'array' : typeof value;
  const realShape = shape(toWidgetData(assets, server, search));
  const demoShape = shape(photos.demo());
  for (const s of [realShape, demoShape]) {
    s.usageBytes = 'number|null';
    s.addedThisWeek = 'number|null';
  }
  assert.deepEqual(demoShape, realShape);
});
