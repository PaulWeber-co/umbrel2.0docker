// Minifunk: the Knuddl crypto, the rules for messages and photos, and a whole
// round trip against a fake Firebase.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { derive, open, seal, secretFromInvite } from '../server/knuddl.js';
import { createStore } from '../server/store.js';
import minifunk, { acceptFunk, cleanText, dayOf, emptyState, prune, toWidgetData, validateFunk, wallStatus } from '../server/widgets/minifunk.js';
import { ago, formatText, textSize, toViews } from '../web/js/features/minifunk.js';

const TZ = 'Europe/Berlin';
const SECRET = 'K7F2M9QX4R8TWE7HJ2NP';
const quiet = { warn() {}, log() {}, error() {} };
// A tiny real JPEG header is enough: only the magic bytes are checked
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64')}`;
const NOW = Date.parse('2026-10-23T18:00:00+02:00');
const funk = (extra = {}) => ({ t: 'funk', id: 'ABC123-x1', at: NOW - 1000, from: 'ABC123', name: 'Lea', text: 'Hallo Wand', ...extra });

test('the XPS derives the same room and key as the Knuddl app', async () => {
  // Made with src/util/crypto.js of DynamicChicken: derive(SECRET), seal(key, …)
  const { room, key } = await derive(SECRET);
  assert.equal(room, 'BPR9VBP9PY9XJWHCZRAS');
  const fromApp = { v: 1, iv: 'ZM0NirZlFsKdJJOv', ct: 'jhXsE1g1zfRy-gk1Q7qcCZdQpQ4dlBPxtljmehxLvnjAPwiXwf9HJqg4oCcfXH-7KWiR8d5xKb86C4Y' };
  assert.deepEqual(await open(key, fromApp), { t: 'funk', text: 'Hallo Wand 🐔', n: 1 });
  assert.deepEqual(await open(key, await seal(key, { a: 1 })), { a: 1 });
  assert.equal(await open(key, { ...fromApp, ct: fromApp.ct.replace(/^./, 'A') }), null, 'tampered');
  assert.equal(secretFromInvite('Komm in mein Nest: ABC123 – K7F2M9QX4R8TWE7HJ2NP'), SECRET);
  assert.equal(secretFromInvite('https://x.github.io/knuddl/?join=ABC123-K7F2M9QX4R8TWE7HJ2NP'), SECRET);
  assert.equal(secretFromInvite('ABC123'), null, 'a bare code has no key');
});

test('messages are checked and cleaned before they reach the wall', () => {
  assert.equal(validateFunk(funk(), NOW).text, 'Hallo Wand');
  assert.equal(validateFunk(funk({ t: 'mood' }), NOW), null);
  assert.equal(validateFunk(funk({ from: '../x' }), NOW), null);
  assert.equal(validateFunk(funk({ at: NOW - 25 * 3_600_000 }), NOW), null, 'waited too long');
  assert.equal(validateFunk(funk({ text: '   ' }), NOW), null, 'nothing to show');
  assert.equal(validateFunk(funk({ name: '' , pet: 'Pieps' }), NOW).name, 'Pieps');
  assert.equal(validateFunk(funk({ photo: JPEG }), NOW).photo.length, 10);
  assert.equal(validateFunk(funk({ photo: 'data:image/svg+xml;base64,PHN2Zz4=' }), NOW).photo, null, 'only JPEG');
  assert.equal(validateFunk(funk({ photo: `data:image/jpeg;base64,${Buffer.from('<html>').toString('base64')}` }), NOW).photo, null, 'JPEG in name only');
  assert.equal(cleanText('Milch\r\n\n\n\nEier  \n'), 'Milch\n\nEier');
  assert.equal(cleanText('x'.repeat(900)).length, 500);
  assert.equal(cleanText(Array.from({ length: 20 }, (_, i) => `- ${i}`).join('\n')).split('\n').length, 12);
});

test('one photo per sender and day; the text of a second photo still shows', () => {
  const options = { now: NOW, timeZone: TZ, textHours: 24, photoHours: 6 };
  let { state, item, photoAccepted } = acceptFunk(emptyState(), validateFunk(funk({ photo: JPEG }), NOW), { ...options, id: 'a'.repeat(16) });
  assert.equal(photoAccepted, true);
  assert.equal(state.photoDay.ABC123, '2026-10-23');
  assert.equal(item.photoUntil, NOW + 6 * 3_600_000);
  ({ state, item, photoAccepted } = acceptFunk(state, validateFunk(funk({ id: 'ABC123-x2', photo: JPEG, text: 'Noch eins' }), NOW), { ...options, id: 'b'.repeat(16) }));
  assert.equal(photoAccepted, false);
  assert.equal(item.text, 'Noch eins');
  assert.equal(item.photoUntil, null);
  const photoOnly = acceptFunk(state, validateFunk(funk({ id: 'ABC123-x3', photo: JPEG, text: '' }), NOW), options);
  assert.equal(photoOnly.item, null, 'a second photo without words is dropped');
  // The other person still has their photo of the day
  assert.equal(acceptFunk(state, validateFunk(funk({ from: 'XYZ789', photo: JPEG }), NOW), options).photoAccepted, true);
  // The next day another one
  const tomorrow = NOW + 24 * 3_600_000;
  assert.equal(acceptFunk(state, validateFunk(funk({ at: tomorrow, photo: JPEG }), tomorrow), { ...options, now: tomorrow }).photoAccepted, true);
});

test('photos go after their hours, words after theirs', () => {
  const options = { timeZone: TZ, textHours: 24, photoHours: 6 };
  let { state } = acceptFunk(emptyState(), validateFunk(funk({ photo: JPEG }), NOW), { ...options, now: NOW, id: 'a'.repeat(16) });
  ({ state } = acceptFunk(state, validateFunk(funk({ id: 'p2', from: 'XYZ789', text: '', photo: JPEG }), NOW), { ...options, now: NOW, id: 'b'.repeat(16) }));
  assert.equal(toWidgetData(state, NOW).items[0].photo, `/api/minifunk/${'b'.repeat(16)}.jpg`);

  const later = prune(state, NOW + 7 * 3_600_000);
  assert.deepEqual(later.removedPhotos.sort(), ['a'.repeat(16), 'b'.repeat(16)]);
  assert.equal(later.state.items.length, 1, 'the photo-only message is gone, the one with words stays');
  assert.equal(toWidgetData(later.state, NOW + 7 * 3_600_000).items[0].photo, null);
  assert.equal(prune(later.state, NOW + 25 * 3_600_000).state.items.length, 0);
});

test('the wall tells the app whether it may funk', () => {
  const status = wallStatus({ display: 'on', music: true, state: { ...emptyState(), photoDay: { ABC123: '2026-10-23' } }, now: NOW, timeZone: TZ, photoHours: 6 });
  assert.deepEqual(status, { t: 'wall', v: 1, at: NOW, display: 'on', available: true, music: true, today: '2026-10-23', photoDay: { ABC123: '2026-10-23' }, maxText: 500, photoHours: 6 });
  assert.equal(wallStatus({ display: 'night', state: emptyState(), now: NOW, timeZone: TZ }).available, false);
  assert.equal(dayOf(Date.parse('2026-10-23T23:30:00Z'), TZ), '2026-10-24', 'the XPS day, not UTC');
});

test('wall texts: size by length, lists as lists, newest photo first', () => {
  assert.equal(textSize('Bin gleich da'), 'xl');
  assert.equal(textSize('Kannst du auf dem Heimweg bitte noch Brot und Käse mitbringen?'), 'l');
  assert.equal(textSize('x'.repeat(150)), 'm');
  assert.equal(textSize('x'.repeat(400)), 's');
  assert.equal(formatText('Einkauf:\n- Milch\n- <Eier>\nDanke'), '<p>Einkauf:</p><ul><li>Milch</li><li>&lt;Eier&gt;</li></ul><p>Danke</p>');
  assert.equal(ago(NOW - 30_000, NOW), 'gerade eben');
  assert.equal(ago(NOW - 5 * 60_000, NOW), 'vor 5 Min.');
  assert.equal(ago(NOW - 3 * 3_600_000, NOW), 'vor 3 Std.');
  const items = [
    { id: '1', text: 'neu', photo: null },
    { id: '2', text: 'Foto', photo: '/p.jpg' },
    { id: '3', text: 'alt', photo: null },
    { id: '4', text: 'älter', photo: '/q.jpg' },
  ];
  assert.deepEqual(toViews(items).map((view) => [view.kind, view.items.map((item) => item.id)]), [
    ['photo', ['2']],
    ['text', ['4', '3', '1']],
  ]);
  assert.deepEqual(toViews([]), []);
});

// A Firebase room in memory: what the app would write, what the XPS deletes
function fakeFirebase() {
  const db = new Map();
  const calls = [];
  const handle = async (url, { method = 'GET', body } = {}) => {
    const path = new URL(url).pathname.replace(/\.json$/, '');
    calls.push(`${method} ${path.replace(/\/r\/[A-Z2-9]+/, '/r/ROOM')}`);
    if (method === 'PUT') db.set(path, JSON.parse(body));
    if (method === 'DELETE') db.delete(path);
    if (method === 'GET') {
      const prefix = `${path}/`;
      const children = Object.fromEntries([...db].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
      return Object.keys(children).length ? children : db.get(path) ?? null;
    }
    return null;
  };
  return {
    db,
    calls,
    fetchJson: handle,
    fetchImpl: async (url, options = {}) => {
      if (options.headers?.accept === 'text/event-stream') {
        // A stream that says "put" once and then ends
        const body = (async function* () {
          yield new TextEncoder().encode('event: put\ndata: {"path":"/","data":null}\n\n');
        })();
        return { ok: true, status: 200, body };
      }
      await handle(url, options);
      return { ok: true, status: 200 };
    },
  };
}

test('round trip: the app funks, the XPS shows it, deletes it from the cloud and reports the photo', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dash-funk-'));
  const store = createStore(dataDir, quiet);
  await store.write('host-state.json', { display: 'on' });
  const firebase = fakeFirebase();
  const { room, key } = await derive(SECRET);
  const base = `/knuddl/r/${room}`;
  firebase.db.set(`${base}/x/funk/-Nabc1`, await seal(key, funk({ at: Date.now() - 1000, photo: JPEG, text: 'Schau mal!' })));
  firebase.db.set(`${base}/x/funk/-Nabc2`, { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' }); // not ours

  const values = { DASH_KNUDDL_INVITE: `ABC123-${SECRET}`, DASH_KNUDDL_URL: 'https://chicken-702b6-default-rtdb.europe-west1.firebasedatabase.app/' };
  const config = { timezone: TZ, dataDir, demo: false, get: (k, fallback = '') => values[k] ?? fallback, num: (_, fallback) => fallback };
  const emitted = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = firebase.fetchImpl; // connectRoom uses it for DELETE and the stream
  const ctx = { config, store, log: quiet, fetchJson: firebase.fetchJson, peek: () => ({ active: false }), now: () => new Date() };
  const stop = minifunk.watch(ctx, (data) => emitted.push(data));
  try {
    for (let i = 0; i < 50 && !emitted.some((data) => data.items.length); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    const data = emitted.at(-1);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].name, 'Lea');
    assert.equal(data.items[0].text, 'Schau mal!');
    const id = data.items[0].id;
    assert.equal(data.items[0].photo, `/api/minifunk/${id}.jpg`);
    assert.ok(existsSync(join(dataDir, 'minifunk', `${id}.jpg`)));
    assert.equal(readFileSync(join(dataDir, 'minifunk', `${id}.jpg`))[0], 0xff);
    // Both records left the database, the readable one and the foreign one
    assert.equal([...firebase.db.keys()].filter((k) => k.includes('/x/funk/')).length, 0);
    // The status now says: Lea's photo of today is taken, the dashboard is on
    const status = await open(key, firebase.db.get(`${base}/x/status`));
    assert.equal(status.available, true);
    assert.equal(status.photoDay.ABC123, dayOf(Date.now(), TZ));
    assert.ok(firebase.calls.includes('PUT /knuddl/r/ROOM/x/status'));

    // × on the wall: gone, file deleted
    await minifunk.actions.dismiss({ ...ctx, payload: { id }, demo: false });
    assert.equal(existsSync(join(dataDir, 'minifunk', `${id}.jpg`)), false);
    assert.equal((await minifunk.fetch(ctx)).items.length, 0);
    await assert.rejects(minifunk.actions.dismiss({ ...ctx, payload: { id: '../../etc' }, demo: false }), (error) => error.status === 400);
  } finally {
    stop();
    globalThis.fetch = realFetch;
  }
});

test('without an invitation Minifunk stays off instead of showing samples', async () => {
  const config = { timezone: TZ, demo: false, get: (_, fallback = '') => fallback };
  const store = { read: async (_, fallback) => fallback, write: async () => {} };
  assert.deepEqual(await minifunk.fetch({ config, store }), { enabled: false, items: [] });
  assert.equal(typeof minifunk.watch({ config, store, log: quiet }, () => {}), 'function');
  const demo = minifunk.demo({ config: { get: (k, fallback) => (k === 'DASH_DEMO_FUNK' ? 'both' : fallback) } });
  assert.equal(demo.items.length, 3);
});
