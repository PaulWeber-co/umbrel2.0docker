import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { DASHBOARD_DIR } from '../server/config.js';
import { createApp } from '../server/http.js';
import { Hub } from '../server/hub.js';
import { DEFAULT_LAYOUT, validateLayout } from '../server/layout.js';
import { createStore } from '../server/store.js';

let server;
let base;
const quiet = { warn() {}, log() {}, error() {} };

before(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dash-data-'));
  const config = { demo: true, name: 'Paul', place: 'Hamburg', timezone: 'Europe/Berlin', glassLevel: 55, mediaDir: dataDir };
  const store = createStore(dataDir, quiet);
  const hub = new Hub({ widgets: [{ id: 'probe', intervalMs: 60_000, fetch: async () => ({}), demo: () => ({ n: 1 }) }], config, store, log: quiet });
  await hub.refresh('probe');
  server = createApp({ hub, store, config, webDir: join(DASHBOARD_DIR, 'web'), defaultLayout: DEFAULT_LAYOUT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test('state lists widgets and the default layout', async () => {
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.name, 'Paul');
  assert.deepEqual(state.widgets.probe.data, { n: 1 });
  assert.deepEqual(state.layout, DEFAULT_LAYOUT);
  assert.deepEqual(state.settings, { glassLevel: 55 });
});

test('glass settings reject invalid levels and persist valid values for every client', async () => {
  const bad = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ glassLevel: 101 }),
  });
  assert.equal(bad.status, 400);

  const saved = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ glassLevel: 82 }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { glassLevel: 82 });
  assert.deepEqual((await (await fetch(`${base}/api/state`)).json()).settings, { glassLevel: 82 });
});

test('layout is validated and saved', async () => {
  const bad = await fetch(`${base}/api/layout`, { method: 'PUT', body: JSON.stringify({ tiles: [{ id: 'a', col: 3, row: 0, w: 2, h: 1 }] }) });
  assert.equal(bad.status, 400);
  const layout = { tiles: [{ id: 'wetter', col: 0, row: 0, w: 2, h: 1 }], hidden: ['fotos'] };
  const ok = await fetch(`${base}/api/layout`, { method: 'PUT', body: JSON.stringify(layout) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/layout`)).json(), layout);
});

test('validateLayout rejects overlaps and duplicates', () => {
  assert.equal(validateLayout(DEFAULT_LAYOUT), null);
  assert.match(validateLayout({ tiles: [{ id: 'a', col: 0, row: 0, w: 2, h: 1 }, { id: 'b', col: 1, row: 0, w: 1, h: 1 }] }), /überlappt/);
  assert.match(validateLayout({ tiles: [{ id: 'a', col: 0, row: 0, w: 1, h: 1 }, { id: 'a', col: 1, row: 0, w: 1, h: 1 }] }), /doppelt/);
});

test('front end is served, paths outside web/ are not', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<div class="stage"/);
  const escape = await fetch(`${base}/..%2fpackage.json`);
  assert.equal(escape.status, 404);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
});

test('events stream starts with the cached widgets', async () => {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { signal: controller.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  let text = '';
  while (!text.includes('event: widget')) text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /event: settings\ndata: \{"glassLevel":82\}/);
  assert.match(text, /"id":"probe"/);
  controller.abort();
});
