// Spotify Connect through go-librespot's local API (server/sources/spotify.js)
// and how it shares music mode with AirPlay (server/widgets/music.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { END_DELAY_MS, inactiveState, PAUSE_TIMEOUT_MS } from '../server/sources/shairport.js';
import { coverAllowed, createSpotifySource, sameState, toState } from '../server/sources/spotify.js';
import { pickState } from '../server/widgets/music.js';

const quiet = { warn() {}, log() {} };
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const COVER = 'https://i.scdn.co/image/ab67616d0000b273abc';

const status = (extra = {}, track = {}) => ({
  username: 'paul',
  device_name: 'XPS Lautsprecher',
  stopped: false,
  paused: false,
  buffering: false,
  volume: 40,
  volume_steps: 64,
  track: { uri: 'spotify:track:1', name: 'Weites Land', artist_names: ['Lea', 'Paul'], album_name: 'Demo', album_cover_url: COVER, position: 61_500, duration: 222_000, ...track },
  ...extra,
});

test('a /status answer becomes the music state', () => {
  const state = toState(status(), 1000, 'data:image/jpeg;base64,x');
  assert.deepEqual(state, {
    ...inactiveState(),
    active: true,
    playing: true,
    title: 'Weites Land',
    artist: 'Lea, Paul',
    album: 'Demo',
    source: 'Spotify',
    coverUrl: 'data:image/jpeg;base64,x',
    position: 61.5,
    duration: 222,
    positionAt: 1000,
    volume: 0.625,
  });
  assert.equal(toState(status({ paused: true }), 0).playing, false);
  assert.equal(toState(status({ buffering: true }), 0).playing, false, 'buffering does not run the bar');
  assert.equal(toState(status({ stopped: true }), 0), null);
  assert.equal(toState(status({ track: null }), 0), null);
  assert.equal(toState(null, 0), null);
  assert.equal(toState(status({}, { duration: 0 }), 0).duration, null, 'a stream without an end');
});

test('only real changes count: the running position does not, a seek does', () => {
  const a = toState(status(), 0);
  const later = toState(status({}, { position: 71_500 }), 10_000);
  assert.ok(sameState(a, later, 10_000), 'ten seconds later, ten seconds further');
  const seek = toState(status({}, { position: 150_000 }), 10_000);
  assert.ok(!sameState(a, seek, 10_000));
  assert.ok(!sameState(a, toState(status({ paused: true }), 0), 0));
  assert.ok(!sameState(a, toState(status({}, { name: 'Anderes Lied' }), 0), 0));
});

test('covers only from Spotify\'s image servers', () => {
  assert.ok(coverAllowed(COVER));
  assert.ok(coverAllowed('https://mosaic.scdn.co/640/abc'));
  assert.ok(coverAllowed('https://image-cdn-ak.spotifycdn.com/image/abc'));
  assert.ok(!coverAllowed('http://i.scdn.co/image/abc'), 'not without TLS');
  assert.ok(!coverAllowed('https://i.scdn.co.example.com/image/abc'));
  assert.ok(!coverAllowed('http://192.168.2.1/'));
  assert.ok(!coverAllowed(null));
});

test('AirPlay and Spotify share music mode: the one that plays wins', () => {
  const air = { ...inactiveState(), active: true, playing: true, title: 'Von AirPlay' };
  const spot = { ...inactiveState(), active: true, playing: true, title: 'Von Spotify' };
  assert.equal(pickState(inactiveState(), inactiveState()).active, false);
  assert.equal(pickState(inactiveState(), inactiveState()).via, null);
  assert.equal(pickState(air, inactiveState()).via, 'airplay');
  assert.equal(pickState(inactiveState(), spot).via, 'spotify');
  assert.equal(pickState({ ...air, playing: false }, spot).title, 'Von Spotify', 'paused AirPlay steps back');
  assert.equal(pickState(air, spot, { airplay: 1, spotify: 2 }).title, 'Von Spotify', 'both playing: the later one');
  assert.equal(pickState(air, spot, { airplay: 3, spotify: 2 }).title, 'Von AirPlay');
});

// go-librespot as a fake: answers what `reply` says, the cover as JPEG bytes
function fakeLibrespot() {
  const calls = [];
  const fake = {
    reply: null, // null → 204, 'down' → connection refused, else the status
    calls,
    fetch: async (url) => {
      calls.push(url);
      if (url.startsWith('https://')) return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
      if (fake.reply === 'down') throw new TypeError('fetch failed');
      if (fake.reply === null) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(fake.reply), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  return fake;
}

test('the source: plays, cover follows, seeks, pauses for long, ends', async () => {
  let clock = 1_000_000;
  const fake = fakeLibrespot();
  const seen = [];
  const warnings = [];
  const source = createSpotifySource({ fetchImpl: fake.fetch, now: () => clock, log: { warn: (text) => warnings.push(text) }, onChange: (state) => seen.push(state) });

  await source.poll();
  assert.equal(seen.length, 0, 'no session: nothing to tell');

  fake.reply = status();
  await source.poll();
  assert.equal(seen.length, 2, 'the track at once, then with its cover');
  assert.equal(seen[0].title, 'Weites Land');
  assert.equal(seen[0].coverUrl, null);
  assert.match(seen[1].coverUrl, /^data:image\/jpeg;base64,/);
  assert.equal(fake.calls.filter((url) => url === COVER).length, 1);

  clock += 2000;
  fake.reply = status({}, { position: 63_500 });
  await source.poll();
  assert.equal(seen.length, 2, 'the bar runs in the browser');
  assert.equal(fake.calls.filter((url) => url === COVER).length, 1, 'the cover is fetched once per track');

  fake.reply = status({}, { position: 180_000 });
  await source.poll();
  assert.equal(seen.at(-1).position, 180, 'a seek is told');

  fake.reply = status({ paused: true }, { position: 180_000 });
  await source.poll();
  assert.equal(seen.at(-1).playing, false);
  clock += PAUSE_TIMEOUT_MS;
  await source.poll();
  assert.equal(seen.at(-1).active, false, 'paused for long: back to the dashboard');

  fake.reply = status();
  await source.poll();
  assert.equal(seen.at(-1).active, true);
  fake.reply = null;
  await source.poll();
  assert.equal(seen.at(-1).active, true, 'between two tracks it stays');
  clock += END_DELAY_MS;
  await source.poll();
  assert.equal(seen.at(-1).active, false);

  fake.reply = 'down';
  await source.poll();
  await source.poll();
  assert.equal(warnings.filter((text) => text.includes('nicht erreichbar')).length, 1, 'said once');

  fake.reply = status({}, { album_cover_url: 'http://192.168.2.1/cover.jpg', name: 'Ohne Cover' });
  await source.poll();
  assert.equal(seen.at(-1).title, 'Ohne Cover');
  assert.equal(seen.at(-1).coverUrl, null);
  assert.ok(!fake.calls.includes('http://192.168.2.1/cover.jpg'), 'never fetched');
});

test('the source polls on its own, faster while something plays', async () => {
  const fake = fakeLibrespot();
  fake.reply = status();
  const delays = [];
  let next = null;
  const source = createSpotifySource({
    fetchImpl: fake.fetch,
    log: quiet,
    setTimer: (fn, ms) => {
      delays.push(ms);
      next = fn;
      return 1;
    },
    clearTimer: () => {},
  });
  source.start();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delays.at(-1), 2000);
  fake.reply = null;
  source.stop();
  await next();
  assert.equal(delays.length, 1, 'stopped: no further polls');
});

test('an unreachable go-librespot is asked only every 30 s', async () => {
  const { UNREACHABLE_POLL_MS } = await import('../server/sources/spotify.js');
  const fake = fakeLibrespot();
  fake.reply = 'down';
  const delays = [];
  let next = null;
  const source = createSpotifySource({
    fetchImpl: fake.fetch,
    log: quiet,
    setTimer: (fn, ms) => {
      delays.push(ms);
      next = fn;
      return 1;
    },
    clearTimer: () => {},
  });
  source.start();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delays.at(-1), UNREACHABLE_POLL_MS);
  assert.equal(UNREACHABLE_POLL_MS, 30_000);
  fake.reply = status();
  await next();
  assert.equal(delays.at(-1), 2000, 'back to fast polls once it answers');
  source.stop();
});
