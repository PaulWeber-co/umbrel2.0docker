import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createAccess, hostName, isAllowedHost, isSameOrigin } from '../server/access.js';
import { DASHBOARD_DIR } from '../server/config.js';
import { createControl } from '../server/control.js';
import { createApp } from '../server/http.js';
import { Hub } from '../server/hub.js';
import { DEFAULT_LAYOUT, validateLayout } from '../server/layout.js';
import { createStore } from '../server/store.js';

let server;
let base;
let control;
const quiet = { warn() {}, log() {}, error() {} };
const json = { 'content-type': 'application/json' };
const put = (path, body, headers = json) => fetch(`${base}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
const post = (path, body, headers = json) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
// fetch() always sends the real Host; node:http lets a test pretend another one
const statusWithHost = (path, host) =>
  new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });

before(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dash-data-'));
  const config = { demo: true, name: 'Paul', place: 'Hamburg', timezone: 'Europe/Berlin', glassLevel: 55, mediaDir: dataDir, get: (_, fallback = '') => fallback };
  const store = createStore(dataDir, quiet);
  const hub = new Hub({ widgets: [{ id: 'probe', intervalMs: 60_000, fetch: async () => ({}), demo: () => ({ n: 1 }) }], config, store, log: quiet });
  await hub.refresh('probe');
  control = createControl({ store, config, hub, log: quiet, readPower: async () => [], statusFile: '/nonexistent' });
  await control.start();
  server = createApp({ hub, store, config, control, webDir: join(DASHBOARD_DIR, 'web'), defaultLayout: DEFAULT_LAYOUT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  control.stop();
  server.closeAllConnections();
  server.close();
});

test('state lists widgets and the default layout', async () => {
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.name, 'Paul');
  assert.deepEqual(state.widgets.probe.data, { n: 1 });
  assert.deepEqual(state.layout, DEFAULT_LAYOUT);
  assert.deepEqual(state.settings, { glassLevel: 55 });
  assert.equal(state.control.settings.mode, 'auto');
  assert.deepEqual(state.access, { local: true, pinRequired: false, locked: false });
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
  const bad = await put('/api/layout', { tiles: [{ id: 'a', col: 3, row: 0, w: 2, h: 1 }] });
  assert.equal(bad.status, 400);
  const layout = { tiles: [{ id: 'wetter', col: 0, row: 0, w: 2, h: 1 }], hidden: ['fotos'] };
  const ok = await put('/api/layout', layout);
  assert.equal(ok.status, 200);
  const saved = await (await fetch(`${base}/api/layout`)).json();
  assert.deepEqual(saved.tiles, layout.tiles);
  // Widgets the saved layout does not know yet are offered as hidden
  const others = DEFAULT_LAYOUT.tiles.map((tile) => tile.id).filter((id) => !['wetter', 'fotos'].includes(id));
  assert.deepEqual(saved.hidden, ['fotos', ...others]);
});

test('validateLayout rejects overlaps and duplicates', () => {
  assert.equal(validateLayout(DEFAULT_LAYOUT), null);
  assert.match(validateLayout({ tiles: [{ id: 'a', col: 0, row: 0, w: 2, h: 1 }, { id: 'b', col: 1, row: 0, w: 1, h: 1 }] }), /überlappt/);
  assert.match(validateLayout({ tiles: [{ id: 'a', col: 0, row: 0, w: 1, h: 1 }, { id: 'a', col: 1, row: 0, w: 1, h: 1 }] }), /doppelt/);
});

test('front end is served, paths outside web/ are not', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(index.headers.get('x-frame-options'), 'DENY');
  assert.match(await index.text(), /<div class="stage"/);
  const page = await fetch(`${base}/steuerung`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="control"/);
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

test('changes must be same-origin JSON from a known host name', async () => {
  // A form or no-cors fetch from another site sends text/plain: refused
  const plain = await post('/api/control/override', { state: 'off', minutes: 5 }, { 'content-type': 'text/plain' });
  assert.equal(plain.status, 415);
  const foreign = await post('/api/control/override', { state: 'off', minutes: 5 }, { ...json, origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  const own = await post('/api/control/override', { clear: true }, { ...json, origin: base });
  assert.equal(own.status, 200);
  // DNS rebinding: the page's own domain arrives as Host
  assert.equal(await statusWithHost('/api/state', 'evil.example'), 403);
  assert.equal(await statusWithHost('/api/state', 'xps.local:7777'), 200);
  // Bodies of actions are objects
  assert.equal((await post('/api/widgets/probe/actions/x', null)).status, 400);
  assert.equal((await post('/api/widgets/probe/actions/x', {})).status, 404);
});

test('control center over HTTP: settings, overrides and taps', async () => {
  const saved = await put('/api/control', { mode: 'off', features: { videos: false } });
  assert.equal(saved.status, 200);
  const snapshot = await saved.json();
  assert.equal(snapshot.settings.mode, 'off');
  assert.equal(snapshot.settings.features.videos, false);
  assert.equal(snapshot.effective.display, 'off');
  assert.equal(snapshot.host.kiosk, false);
  assert.equal((await put('/api/control', { mode: 'sometimes' })).status, 400);

  const override = await (await post('/api/control/override', { state: 'on', minutes: 30 })).json();
  assert.equal(override.effective.display, 'on');
  assert.equal(override.effective.source, 'override');
  assert.equal((await post('/api/control/override', { state: 'on', minutes: 99999 })).status, 400);
  await post('/api/control/override', { clear: true });
  assert.equal((await (await fetch(`${base}/api/control`)).json()).effective.display, 'off');
  assert.equal((await post('/api/control/wake', {})).status, 200);
  await put('/api/control', { mode: 'auto', features: { videos: true } });
});

test('host names and origins', () => {
  for (const host of ['xps.local:7777', 'xps', '192.168.2.40:7777', '[fe80::1]:7777', 'localhost', 'xps.tail1234.ts.net', 'xps.fritz.box']) {
    assert.equal(isAllowedHost(host), true, host);
  }
  for (const host of ['evil.example', 'xps.local.evil.example', '', undefined, 'evil.example:7777@xps.local', 'evil.example@xps.local', 'xps local', '[fe80::1%eth0]:7777']) {
    assert.equal(isAllowedHost(host), false, String(host));
  }
  assert.equal(isAllowedHost('dashboard.example.org', ['dashboard.example.org']), true);
  assert.equal(hostName('[::1]:7777'), '::1');
  assert.equal(isSameOrigin('http://xps.local:7777', 'xps.local:7777'), true);
  assert.equal(isSameOrigin('http://xps.local:7777', 'xps.local:7778'), false);
  assert.equal(isSameOrigin('null', 'xps.local:7777'), false);
});

test('the PIN locks changes from other devices, not from the kiosk', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dash-pin-'));
  const store = createStore(dataDir, quiet);
  let clock = 0;
  const access = createAccess({ config: { get: (key) => (key === 'DASH_PIN' ? '4711' : '') }, store, now: () => clock });
  const remote = (cookie) => ({ socket: { remoteAddress: '192.168.2.20' }, headers: { cookie } });
  const kiosk = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} };

  assert.equal(await access.canChange(kiosk), true);
  assert.equal(await access.canChange(remote()), false);
  assert.deepEqual(await access.status(remote()), { local: false, pinRequired: true, locked: true });
  await assert.rejects(access.unlock(remote(), '0000'), (error) => error.status === 401);
  const cookie = await access.unlock(remote(), ' 4711 ');
  assert.match(cookie, /^xps_dash=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict/);
  const value = cookie.split(';')[0];
  assert.equal(await access.canChange(remote(value)), true);
  assert.equal(await access.canChange(remote('xps_dash=forged')), false);

  // Five wrong PINs lock this address out for ten minutes
  for (let i = 0; i < 5; i++) await assert.rejects(access.unlock(remote(), 'nope'), (error) => error.status === 401);
  await assert.rejects(access.unlock(remote(), '4711'), (error) => error.status === 429);
  clock += 10 * 60_000 + 1;
  assert.match(await access.unlock(remote(), '4711'), /^xps_dash=/);

  // Home Assistant sends the PIN as a header instead of a cookie
  const automation = (pin) => ({ socket: { remoteAddress: '172.17.0.5' }, headers: { 'x-dashboard-pin': pin } });
  assert.equal(await access.canChange(automation('4711')), true);
  assert.equal(await access.canChange(automation('1234')), false);

  // Guessing from many addresses: twenty wrong PINs lock out everyone but the kiosk
  clock += 10 * 60_000 + 1;
  const from = (n) => ({ socket: { remoteAddress: `192.168.2.${100 + n}` }, headers: {} });
  for (let n = 0; n < 20; n++) await assert.rejects(access.unlock(from(n), String(1000 + n)), (error) => error.status === 401);
  await assert.rejects(access.unlock(from(50), '4711'), (error) => error.status === 429);
  await assert.rejects(access.canChange(automation('4711')), (error) => error.status === 429);
  assert.equal(await access.canChange(kiosk), true);
  clock += 10 * 60_000 + 1;
  assert.equal(await access.canChange(automation('4711')), true);
});
