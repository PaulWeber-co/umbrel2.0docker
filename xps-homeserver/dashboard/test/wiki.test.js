import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { clean, createWikiWidget, localDay, pick, shorten, toFeed } from '../server/widgets/wiki.js';
import { fit, render } from '../web/js/widgets/wiki.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/wikipedia-featured.json', import.meta.url), 'utf8'));
const TZ = 'Europe/Berlin';
// Tuesday 27 October 2026 in Hamburg (CET, UTC+1)
const at = (time) => new Date(`2026-10-27T${time}+01:00`);

test('main page markers for its own picture are dropped', () => {
  assert.equal(clean('Marie von Olfers (Bild), deutsche Schriftstellerin'), 'Marie von Olfers, deutsche Schriftstellerin');
  assert.equal(clean('Ein Schiff (im Bild)  sinkt.'), 'Ein Schiff sinkt.');
  assert.equal(clean('Die Klammer (Bilder) bleibt'), 'Die Klammer (Bilder) bleibt');
});

test('long texts end at the last sentence that fits', () => {
  const text = `${'Erster Satz ist da. '.repeat(10)}Und noch einer.`;
  const short = shorten(text, 120);
  assert.ok(short.length <= 120);
  assert.match(short, /\.$/);
  assert.equal(shorten('kurz', 120), 'kurz');
  assert.match(shorten('wort '.repeat(60), 50), / …$/);
});

test('the feed becomes events, facts and the article', () => {
  const feed = toFeed(fixture);
  assert.equal(feed.events.length, 5);
  assert.deepEqual(feed.events.map((event) => event.year), [1996, 1991, 1876, 1826, 1726]);
  assert.equal(feed.events[0].title, 'Nationalpark Donau-Auen');
  assert.match(feed.events[0].thumb, /^https:\/\/(upload|thumb)\.wikimedia\.org\//);
  assert.ok(!feed.events.some((event) => event.text.includes('(Bild)')));
  assert.equal(feed.facts.length, 8);
  assert.ok(feed.facts.every((fact) => fact.text && fact.year === null));
  assert.equal(feed.article.title, 'Scurra');
  assert.ok(feed.article.text.length <= 280);
});

test('an empty or broken feed gives empty parts', () => {
  assert.deepEqual(toFeed({}), { events: [], facts: [], article: null });
  assert.deepEqual(toFeed(null), { events: [], facts: [], article: null });
  const feed = toFeed({ onthisday: [{ text: 'x', pages: [{ thumbnail: { source: 'https://evil.example/a.jpg' } }] }] });
  assert.equal(feed.events[0].thumb, null, 'pictures only from Wikimedia');
});

test('local day, hour and German date', () => {
  assert.deepEqual(localDay(at('00:30:00'), TZ), { key: '2026/10/27', hour: 0, label: '27. Oktober' });
  assert.equal(localDay(new Date('2026-10-27T23:30:00Z'), TZ).key, '2026/10/28', 'after midnight in Hamburg');
});

test('mornings events, afternoons facts, evenings the article', () => {
  const feed = toFeed(fixture);
  const morning = pick(feed, at('08:00:00'), TZ);
  assert.equal(morning.kind, 'events');
  assert.equal(morning.heading, 'Am 27. Oktober');
  assert.equal(morning.count, 5);
  assert.equal(pick(feed, at('12:00:00'), TZ).kind, 'facts');
  assert.equal(pick(feed, at('12:00:00'), TZ).heading, 'Schon gewusst?');
  const evening = pick(feed, at('18:00:00'), TZ);
  assert.equal(evening.kind, 'article');
  assert.equal(evening.title, 'Scurra');
  assert.equal(evening.heading, 'Artikel des Tages');
});

test('items take turns every minute', () => {
  const feed = toFeed(fixture);
  const first = pick(feed, at('08:00:00'), TZ);
  const next = pick(feed, at('08:01:00'), TZ);
  assert.notEqual(first.text, next.text);
  assert.equal(next.position, (first.position % 5) + 1);
  assert.equal(pick(feed, at('08:05:00'), TZ).text, first.text, 'round after five minutes');
});

test('an empty part falls back to the next one', () => {
  const feed = toFeed(fixture);
  assert.equal(pick({ ...feed, article: null }, at('20:00:00'), TZ).kind, 'events');
  assert.equal(pick({ ...feed, facts: [] }, at('14:00:00'), TZ).kind, 'events');
  assert.equal(pick({ events: [], facts: [], article: null }, at('08:00:00'), TZ), null);
});

function fakeCtx({ now = at('08:00:00'), feed = fixture, fail = false, bytes } = {}) {
  const calls = { json: 0, bytes: 0 };
  return {
    calls,
    config: { timezone: TZ },
    log: { warn() {} },
    now: () => now,
    fetchJson: async (url, options) => {
      calls.json++;
      assert.match(url, /\/feed\/v1\/wikipedia\/de\/featured\/2026\/10\/27$/);
      assert.ok(options.headers['api-user-agent']);
      if (fail) throw new Error('offline');
      return feed;
    },
    fetchBytes: async () => {
      calls.bytes++;
      return bytes ?? { bytes: Buffer.from([0xff, 0xd8, 0xff]), type: 'image/jpeg' };
    },
  };
}

test('fetch shows the item with its picture as a data URI', async () => {
  const widget = createWikiWidget();
  const ctx = fakeCtx();
  const data = await widget.fetch(ctx);
  assert.equal(data.kind, 'events');
  assert.equal(data.image, 'data:image/jpeg;base64,/9j/');
  assert.equal('thumb' in data, false, 'the picture URL stays on the server');
  await widget.fetch(ctx);
  assert.equal(ctx.calls.json, 1, 'one feed request a day');
  assert.equal(ctx.calls.bytes, 1, 'pictures are kept');
});

test('a picture that is no image is left out', async () => {
  const data = await createWikiWidget().fetch(fakeCtx({ bytes: { bytes: Buffer.from('<svg/>'), type: 'image/svg+xml' } }));
  assert.equal(data.image, null);
});

test('without network the day keeps its feed, a new day throws', async () => {
  const widget = createWikiWidget();
  await widget.fetch(fakeCtx());
  const later = fakeCtx({ now: at('11:30:00'), fail: true });
  assert.equal((await widget.fetch(later)).kind, 'events');
  await assert.rejects(createWikiWidget().fetch(fakeCtx({ fail: true })), /offline/);
});

test('demo data has the shape of real data', async () => {
  const real = await createWikiWidget().fetch(fakeCtx());
  const demo = createWikiWidget().demo();
  assert.deepEqual(Object.keys(demo).sort(), Object.keys(real).sort());
});

test('the tile escapes text and shows only data URIs as pictures', () => {
  const html = render({ kind: 'events', heading: 'Am 27. Oktober', year: 1996, title: 'x', text: '<b>Text</b>', position: 2, count: 5, image: 'https://evil.example/a.jpg' });
  assert.ok(!html.includes('<b>'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /2\/5/);
  assert.match(html, /1996/);
  const pic = render({ kind: 'article', heading: 'Artikel des Tages', year: null, title: 'Scurra', text: 'Kurz.', position: 1, count: 1, image: 'data:image/jpeg;base64,/9j/' });
  assert.match(pic, /<img class="wk-img" src="data:image\/jpeg;base64,\/9j\/"/);
  assert.match(pic, /Scurra/);
  assert.ok(!pic.includes('1/1'));
  assert.match(render(null), /Lädt/);
});

test('the text is as large as length and picture allow', () => {
  assert.equal(fit('kurz'), ' wk-s28');
  assert.equal(fit('x'.repeat(150)), ' wk-s24');
  assert.equal(fit(`${'x­'.repeat(150)}`), ' wk-s24', 'soft hyphens do not count');
  assert.equal(fit('x'.repeat(170)), ' wk-s21');
  assert.equal(fit('x'.repeat(240)), ' wk-s18');
  assert.equal(fit('kurz', true), ' wk-s20');
  assert.equal(fit('x'.repeat(170), true), ' wk-s18');
  assert.equal(fit('x'.repeat(210), true), ' wk-s16');
});
