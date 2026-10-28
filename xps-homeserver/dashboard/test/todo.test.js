// The to-do tile: the Knuddl app's list package (x/liste), checked, turned
// into what the wall shows, and a round trip against a fake Firebase.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { derive, open, seal } from '../server/knuddl.js';
import { createStore } from '../server/store.js';
import todo, { demoListe, dueText, toWidgetData, validateListe } from '../server/widgets/todo.js';
import { render } from '../web/js/widgets/todo.js';

const TZ = 'Europe/Berlin';
const SECRET = 'K7F2M9QX4R8TWE7HJ2NP';
const quiet = { warn() {}, log() {}, error() {} };
const NOW = new Date('2026-10-27T18:00:00+01:00');

// A package as listeFuerWand() of DynamicChicken writes it (Paul lila, Jane pink),
// sealed with derive(SECRET) and seal(); that the XPS opens what the app
// itself sealed shows test/minifunk.test.js with an app-made package
const FROM_APP = { v: 1, iv: 'ZOGAHpZMyZ2PWxFm', ct: 'BsvbJlmZJdMF66hYCFYdFLQhELvIQTcO-3chYqwwSLjIdgdl3Y-9WnyxJXl6F2vi4--eyXzSfj1m7axRLlbWLNBzORSWvYqhuc_CBXk-7m6rykK2OnRukCMx5INp-RvZUQxQLMRKXxfSS24SOELFQKZwxy-_bnB3oNM5KO60hgXm-RSOKXy0E_NYSsbG9QjycTXDc9ECrOu68DrTPLS8IFPd58fywG3QARHqzVMeVX5zUwt0tjp-W3fHNQ4qcV4UL99EFEkj1CeTjDiY-EIznPF1WSPwRd2D62ltsvr8ZzSHYkc0PCAQ9S6WEE7MR5YDcR2lOzYq_obxR7sHTTLrDIlBk9o9BZziiVwoEgM29dKDSnnGTc32LLgOqMHg4jVaumR0n4_AnpHvPcPwmYkCNJ78PtlBCC80HShf0pRBZjuRMFSfkuVAC6YSUCuDQEuQqzSPrZmQMTfxjDMYCn9Noxmwv6ViIQh7rSyD4FYpwbjvygp7f5UjKZ6DUiCrRSptwEhgADrWI6fJFTUpH9vIBznKD8wxhCL9DXjQI6fJGN1pRr-MaE_aamkoTaXlW-14mcQjGq0nYunXan7fHuogAJ-xiBZF_9VZM-ZWRbSquGK5SG2csIRGQsdfjGTkXZAkeGVUGa54TtcFS-SWqWGt0_PsifIpnPp0XduzLtu11P3Z5w8' };

test('the package the app sealed opens on the XPS', async () => {
  const { key } = await derive(SECRET);
  const liste = validateListe(await open(key, FROM_APP));
  assert.deepEqual(liste.leute, [{ code: 'PAUL01', name: 'Paul', farbe: 'lila' }, { code: 'JANE01', name: 'Jane', farbe: 'pink' }]);
  assert.deepEqual(liste.todos.map((t) => [t.text, t.due, t.who]), [['Geschenk für Oma', '2026-10-27', 'JANE01'], ['Fahrrad zur Werkstatt', null, 'wir']]);
  assert.deepEqual(liste.bucket[0], { text: 'Nordlichter in Norwegen sehen', stimmen: { PAUL01: 1, JANE01: 1 }, einig: true, unbedingt: true });
});

test('everything in the package is checked', () => {
  assert.equal(validateListe(null), null);
  assert.equal(validateListe({ ...demoListe(), t: 'funk' }), null);
  assert.equal(validateListe({ ...demoListe(), v: 2 }), null);
  assert.equal(validateListe({ ...demoListe(), at: 'gestern' }), null);
  const liste = validateListe({
    ...demoListe(),
    leute: [{ code: '../x', name: 'Böse' }, { code: 'PAUL01', name: 'P'.repeat(80), farbe: 'grün' }, { code: 'JANE01', name: 'Jane', farbe: 'pink' }, { code: 'DRITT1', name: 'Dritte' }],
    todos: [{ text: '  viel   Platz ', due: '27.10.2026', who: 'FREMD1' }, { text: '', who: 'PAUL01' }, ...Array.from({ length: 20 }, (_, i) => ({ text: `t${i}` }))],
    bucket: [{ text: 'x', stimmen: { PAUL01: 1, JANE01: 7, FREMD1: 1 }, einig: 'ja' }],
    offen: -3,
  });
  assert.deepEqual(liste.leute.map((p) => [p.code, p.name.length, p.farbe]), [['PAUL01', 40, 'lila'], ['JANE01', 4, 'pink']], 'two people, sane names and colours');
  assert.deepEqual(liste.todos[0], { text: 'viel Platz', due: null, who: 'wir' }, 'bad dates and strangers dropped');
  assert.equal(liste.todos.length, 11, 'twelve at most, the empty one gone');
  assert.deepEqual(liste.bucket[0].stimmen, { PAUL01: 1 });
  assert.equal(liste.bucket[0].einig, false);
  assert.equal(liste.offen, liste.todos.length);
});

test('due dates in words, colours and names instead of codes, one bucket item a minute', () => {
  assert.deepEqual(dueText('2026-10-25', '2026-10-27'), { gruppe: 'ueberfaellig', wann: 'seit 25. Okt.' });
  assert.deepEqual(dueText('2026-10-27', '2026-10-27'), { gruppe: 'heute', wann: 'heute' });
  assert.deepEqual(dueText('2026-10-28', '2026-10-27'), { gruppe: 'morgen', wann: 'morgen' });
  assert.deepEqual(dueText('2026-10-30', '2026-10-27'), { gruppe: 'woche', wann: 'Fr' });
  assert.deepEqual(dueText(null, '2026-10-27'), { gruppe: 'ohne', wann: '' });
  const liste = validateListe(demoListe(NOW.getTime()));
  const data = toWidgetData(liste, NOW, TZ);
  assert.deepEqual(data.todos[0], { text: 'Geschenk für Oma', gruppe: 'heute', wann: 'heute', name: 'Jane', farbe: 'pink' });
  assert.deepEqual(data.todos[2], { text: 'Fahrrad zur Werkstatt', gruppe: 'ohne', wann: '', name: 'Zusammen', farbe: 'wir' });
  assert.ok(!JSON.stringify(data).includes('PAUL01'), 'no codes for the browsers');
  assert.deepEqual(data.bucket[2].stimmen, [{ name: 'Paul', farbe: 'lila', l: 2 }, { name: 'Jane', farbe: 'pink', l: null }]);
  const seen = new Set([0, 1, 2, 3].map((minute) => toWidgetData(liste, new Date(NOW.getTime() + minute * 60_000), TZ).fokus));
  assert.deepEqual([...seen].sort(), [0, 1, 2], 'every bucket item gets its minute');
  assert.deepEqual(toWidgetData(null, NOW, TZ), { leer: true, todos: [], offen: 0, bucket: [], fokus: 0 });
});

test('the tile: to-dos without a legend; all done shows the bucket list and says so', () => {
  const liste = validateListe(demoListe(NOW.getTime()));
  const offen = render(toWidgetData(liste, NOW, TZ));
  assert.match(offen, /Unsere To-dos<em>4<\/em>/);
  assert.match(offen, /td-kreis td-pink"><\/span><span class="td-text">Geschenk für Oma/);
  assert.match(offen, /td-kreis td-wir/);
  assert.doesNotMatch(offen, /zu zweit/, 'no legend');
  const fertig = render(toWidgetData({ ...liste, todos: [], offen: 0 }, NOW, TZ));
  assert.match(fertig, />Bucketlist<em>\d \/ 3<\/em>/);
  assert.match(fertig, /td-gross/);
  assert.match(fertig, /beide unbedingt|wollt ihr beide/);
  assert.match(fertig, /To-dos erledigt ✓/);
  const boese = render(toWidgetData(validateListe({ ...demoListe(), todos: [{ text: '<img src=x onerror=alert(1)>', who: 'wir' }] }), NOW, TZ));
  assert.ok(!boese.includes('<img'), 'texts are escaped');
  assert.match(render(toWidgetData(null, NOW, TZ)), /Noch nichts aus Knuddl/);
});

function fakeFirebase() {
  const db = new Map();
  const fetchJson = async (url, { method = 'GET', body } = {}) => {
    const path = new URL(url).pathname.replace(/\.json$/, '');
    if (method === 'PUT') db.set(path, JSON.parse(body));
    return method === 'GET' ? db.get(path) ?? null : null;
  };
  return {
    db,
    fetchJson,
    fetchImpl: async (url, options = {}) => {
      if (options.headers?.accept === 'text/event-stream') {
        // A stream that says "put" once and then ends
        const body = (async function* () {
          yield new TextEncoder().encode('event: put\ndata: {"path":"/","data":null}\n\n');
        })();
        return { ok: true, status: 200, body };
      }
      return { ok: true, status: 200 };
    },
  };
}

test('round trip: the app writes its lists, the wall shows them and keeps them for a restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dash-todo-'));
  const store = createStore(dataDir, quiet);
  const firebase = fakeFirebase();
  const { room, key } = await derive(SECRET);
  firebase.db.set(`/knuddl/r/${room}/x/liste`, FROM_APP);
  const values = { DASH_KNUDDL_INVITE: `ABC123-${SECRET}`, DASH_KNUDDL_URL: 'https://chicken-702b6-default-rtdb.europe-west1.firebasedatabase.app/' };
  const config = { timezone: TZ, dataDir, demo: false, get: (k, fallback = '') => values[k] ?? fallback };
  const realFetch = globalThis.fetch;
  globalThis.fetch = firebase.fetchImpl; // connectRoom uses it for the stream
  const emitted = [];
  const ctx = { config, store, log: quiet, fetchJson: firebase.fetchJson, now: () => NOW };
  assert.equal(todo.isConfigured(config), true);
  const stop = todo.watch(ctx, (data) => emitted.push(data));
  try {
    for (let i = 0; i < 250 && !emitted.some((data) => data.todos.length); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    const data = emitted.at(-1);
    assert.deepEqual(data.todos.map((t) => [t.text, t.farbe, t.wann]), [['Geschenk für Oma', 'pink', 'heute'], ['Fahrrad zur Werkstatt', 'wir', '']]);
    assert.equal(data.bucket[0].unbedingt, true);

    // An older package (the other phone, a moment behind) does not win
    const older = await open(key, FROM_APP);
    firebase.db.set(`/knuddl/r/${room}/x/liste`, await seal(key, { ...older, at: older.at - 60_000, todos: [] }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await todo.fetch(ctx)).todos.length, 2);

    // Kept on disk: after a restart without internet the list is still there
    stop();
    const offline = await todo.fetch({ ...ctx });
    assert.equal(offline.todos[0].text, 'Geschenk für Oma');
  } finally {
    stop();
    globalThis.fetch = realFetch;
  }
});

test('without an invitation the tile shows its example', () => {
  const config = { timezone: TZ, demo: false, get: (_, fallback = '') => fallback };
  assert.equal(todo.isConfigured(config), false);
  const demo = todo.demo({ config, now: () => NOW });
  assert.equal(demo.todos.length, 4);
  const done = todo.demo({ config: { ...config, get: (k, fallback) => (k === 'DASH_DEMO_TODO' ? 'erledigt' : fallback) }, now: () => NOW });
  assert.equal(done.todos.length, 0);
  assert.equal(done.bucket.length, 3);
});
