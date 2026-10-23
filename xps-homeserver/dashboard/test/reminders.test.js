// A list from Apple's Reminders on the to-do tile, kept in sync by an iOS
// shortcut (server/sources/reminders.js, server/widgets/todo.js).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { DASHBOARD_DIR } from '../server/config.js';
import { createApp } from '../server/http.js';
import { Hub } from '../server/hub.js';
import { DEFAULT_LAYOUT } from '../server/layout.js';
import { addItem, applySync, cleanTitles, complete, emptyState, toWidgetData } from '../server/sources/reminders.js';
import { createStore } from '../server/store.js';
import todo from '../server/widgets/todo.js';
import { render } from '../web/js/widgets/todo.js';

const quiet = { warn() {}, log() {}, error() {} };
const DAY = 24 * 60 * 60_000;
const titles = (data) => data.items.map((item) => (item.pending ? `${item.summary} (neu)` : item.summary));

test('what a shortcut may send', () => {
  assert.deepEqual(cleanTitles({ text: 'Milch\r\n  Brot \n\nmilch\nKaffee  Bohnen' }), ['Milch', 'Brot', 'Kaffee Bohnen']);
  assert.deepEqual(cleanTitles({ items: ['Milch', { title: 'Brot' }, null, 7] }), ['Milch', 'Brot', '7']);
  assert.deepEqual(cleanTitles({}), []);
  assert.equal(cleanTitles({ text: 'x'.repeat(500) })[0].length, 160);
  assert.equal(cleanTitles({ text: Array.from({ length: 300 }, (_, i) => `T${i}`).join('\n') }).length, 200);
});

test('ticked and typed on the wall reach Reminders and stay until it confirms', () => {
  let now = Date.parse('2026-10-23T10:00:00Z');
  let { state, reply } = applySync(emptyState(), ['Milch', 'Brot', 'Basilikum'], now);
  assert.deepEqual(reply, { done: [], add: [] });
  assert.deepEqual(titles(toWidgetData(state, 'Einkauf')), ['Milch', 'Brot', 'Basilikum']);

  state = complete(state, 'milch', now);
  state = addItem(state, 'Kaffee', now);
  state = addItem(state, 'brot', now); // already on the list
  assert.deepEqual(titles(toWidgetData(state, 'Einkauf')), ['Brot', 'Basilikum', 'Kaffee (neu)']);

  // The shortcut runs, its list does not know yet: it is told what to do
  ({ state, reply } = applySync(state, ['Milch', 'Brot', 'Basilikum'], (now += 60_000)));
  assert.deepEqual(reply, { done: ['Milch'], add: ['Kaffee'] });
  // It failed halfway: the next run gets the same answer
  ({ state, reply } = applySync(state, ['Milch', 'Brot', 'Basilikum'], (now += 60_000)));
  assert.deepEqual(reply, { done: ['Milch'], add: ['Kaffee'] });
  // Done in Reminders: confirmed, nothing left to do
  ({ state, reply } = applySync(state, ['Brot', 'Basilikum', 'Kaffee'], (now += 60_000)));
  assert.deepEqual(reply, { done: [], add: [] });
  assert.deepEqual(titles(toWidgetData(state, 'Einkauf')), ['Brot', 'Basilikum', 'Kaffee']);
  assert.equal(toWidgetData(state, 'Einkauf').syncedAt, now);
});

test('second thoughts on the wall, and changes nobody confirms for a week', () => {
  const now = Date.parse('2026-10-23T10:00:00Z');
  let { state } = applySync(emptyState(), ['Milch'], now);
  state = addItem(state, 'Eier', now);
  state = complete(state, 'eier', now);
  assert.deepEqual(state.add, [], 'typed and ticked before any sync: forgotten');
  state = complete(state, 'Milch', now);
  state = addItem(state, 'Milch', now);
  assert.deepEqual(state.done, [], 'ticked and typed again: it stays');
  state = complete(state, 'gibt es nicht', now);
  assert.deepEqual(state.done, []);

  state = addItem(complete(state, 'Milch', now), 'Butter', now);
  const { reply } = applySync(state, ['Milch'], now + 8 * DAY);
  assert.deepEqual(reply, { done: [], add: [] }, 'a shortcut silent for a week: the wall lets go');
});

test('the tile names the list and says when it waits for the iPhone', () => {
  const waiting = render(toWidgetData(emptyState(), 'Einkauf'));
  assert.match(waiting, /Einkauf/);
  assert.match(waiting, /Wartet auf den ersten Abgleich/);
  const { state } = applySync(emptyState(), ['Milch'], 1);
  const html = render(toWidgetData(addItem(state, 'Kaffee', 2), 'Einkauf'));
  assert.match(html, /<em>2<\/em>/);
  assert.match(html, /is-pending/);
  assert.match(html, /Auf „Einkauf“/);
  assert.match(render([{ uid: 'a', summary: 'HA-Aufgabe', due: null }]), /To-dos<em>1<\/em>/, 'Home Assistant as before');
});

let server;
let base;
let dataDir;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'dash-reminders-'));
  const settings = { DASH_REMINDERS_LIST: 'Einkauf' };
  const config = { demo: false, name: '', place: 'Hamburg', timezone: 'Europe/Berlin', glassLevel: 55, mediaDir: dataDir, get: (key, fallback = '') => settings[key] ?? fallback };
  const store = createStore(dataDir, quiet);
  const hub = new Hub({ widgets: [todo], config, store, log: quiet });
  await hub.refresh('todo');
  server = createApp({ hub, store, config, webDir: join(DASHBOARD_DIR, 'web'), defaultLayout: DEFAULT_LAYOUT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// Like "Get Contents of URL" in Shortcuts: POST, JSON, no Origin header
const action = async (name, body) => {
  const response = await fetch(`${base}/api/widgets/todo/actions/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const tile = async () => (await (await fetch(`${base}/api/state`)).json()).widgets.todo;

test('over HTTP: the shortcut syncs, the wall changes, both at once lose nothing', async () => {
  assert.equal((await tile()).demo, false);
  let answer = await action('sync', { text: 'Milch\nBrot\nBasilikum' });
  assert.deepEqual(answer, { status: 200, body: { ok: true, result: { done: [], add: [] } } });
  assert.deepEqual(titles((await tile()).data), ['Milch', 'Brot', 'Basilikum']);

  // A tick on the wall and a run of the shortcut in the same moment
  const [, , synced] = await Promise.all([action('complete', { uid: 'brot' }), action('add', { item: 'Kaffee' }), action('sync', { text: 'Milch\nBrot\nBasilikum' })]);
  assert.equal(synced.status, 200);
  answer = await action('sync', { text: 'Milch\nBrot\nBasilikum' });
  assert.deepEqual(answer.body.result, { done: ['Brot'], add: ['Kaffee'] });
  assert.deepEqual(titles((await tile()).data), ['Milch', 'Basilikum', 'Kaffee (neu)']);

  answer = await action('sync', { items: ['Milch', 'Basilikum', 'Kaffee'] });
  assert.deepEqual(answer.body.result, { done: [], add: [] });
  assert.deepEqual(titles((await tile()).data), ['Milch', 'Basilikum', 'Kaffee']);
});
