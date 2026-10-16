import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hub } from '../server/hub.js';
import { DEFAULT_LAYOUT } from '../server/layout.js';
import {
  coverDataUrl,
  createPipeReader,
  createShairportSource,
  END_DELAY_MS,
  fourcc,
  inactiveState,
  MAX_COVER_BYTES,
  MetadataParser,
  PAUSE_TIMEOUT_MS,
  parseItem,
  parseProgress,
  parseVolume,
  PlayerState,
  sniffImage,
} from '../server/sources/shairport.js';
import music, { DEMO_COVER } from '../server/widgets/music.js';
import { rectFor } from '../web/js/layout.js';
import { averageColour, brighten, formatTime, musicRects, progressAt, SLOTS } from '../web/js/features/music.js';

const FIXTURE = new URL('./fixtures/shairport-metadata.txt', import.meta.url);
const stream = readFileSync(FIXTURE);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const quiet = { warn() {}, log() {}, error() {} };
const onLinux = process.platform === 'linux' ? {} : { skip: 'braucht mkfifo (Linux)' };

// One item in shairport-sync's pipe format
const hex = (text) => Buffer.from(text, 'latin1').toString('hex');
function item(type, code, data) {
  const bytes = data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const head = `<item><type>${hex(type)}</type><code>${hex(code)}</code><length>${bytes.length}</length>`;
  if (!bytes.length) return `${head}</item>\n`;
  return `${head}\n<data encoding="base64">\n${bytes.toString('base64').match(/.{1,60}/g).join('\n')}</data></item>\n`;
}

function parseAll(chunks, options) {
  const items = [];
  const parser = new MetadataParser((found) => items.push(found), options);
  for (const chunk of chunks) parser.push(chunk);
  return items;
}

// A clock and timers the test moves forward by hand
function fakeClock(start = Date.UTC(2026, 9, 16, 18, 0, 0)) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (run, ms) => {
      timers.set(nextId, { run, at: now + ms });
      return nextId++;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
}

function player(clock = fakeClock()) {
  const changes = [];
  const state = new PlayerState({ now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onChange: (s) => changes.push(s) });
  const parser = new MetadataParser((found) => state.handle(found));
  return { clock, changes, state, feed: (...texts) => texts.forEach((text) => parser.push(text)) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, what, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Zeitlimit: ${what}`);
    await sleep(10);
  }
}

// Writes into the FIFO from another process, like shairport-sync does
function writeTo(path, text) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1], process.argv[2])', path, text], { timeout: 5000 }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

/* ---------- parser ---------- */

test('items: four-character codes and base64 data', () => {
  assert.equal(fourcc('73736e63'), 'ssnc');
  assert.equal(fourcc('50494354'), 'PICT');
  const title = parseItem('<item><type>636f7265</type><code>6d696e6d</code><length>11</length>\n<data encoding="base64">\nV2VpdGVzIExhbmQ=</data></item>');
  assert.deepEqual({ ...title, data: title.data.toString() }, { type: 'core', code: 'minm', length: 11, data: 'Weites Land' });
  const begin = parseItem('<item><type>73736e63</type><code>70626567</code><length>0</length></item>');
  assert.equal(begin.code, 'pbeg');
  assert.equal(begin.data.length, 0);
  assert.equal(parseItem('<item>Unsinn</item>'), null);
});

test('parser reads a realistic shairport-sync stream', () => {
  const items = parseAll([stream]);
  assert.deepEqual(
    items.map(({ type, code }) => `${type}/${code}`),
    ['ssnc/snam', 'ssnc/snua', 'ssnc/pvol', 'ssnc/pbeg', 'ssnc/mdst', 'core/mper', 'core/asal', 'core/asar', 'core/minm', 'core/asgn', 'ssnc/mden', 'ssnc/pcst', 'ssnc/PICT', 'ssnc/pcen', 'ssnc/prgr'],
  );
  const byCode = Object.fromEntries(items.map((found) => [found.code, found]));
  assert.equal(byCode.asar.data.toString('utf8'), 'Beispiel-Künstlerin');
  assert.equal(byCode.snam.data.toString('utf8'), 'Pauls iPhone');
  assert.deepEqual(byCode.PICT.data, PNG);
  assert.equal(byCode.PICT.length, PNG.length);
  // Byte by byte gives exactly the same
  const bytewise = parseAll([...stream].map((byte) => Buffer.from([byte])));
  assert.deepEqual(bytewise, items);
});

test('an item split at any offset is read exactly once', () => {
  for (const single of [item('core', 'minm', 'Weites Land'), item('ssnc', 'PICT', PNG), item('ssnc', 'pend')]) {
    const text = item('ssnc', 'mdst', '1') + single + item('ssnc', 'mden', '1');
    const whole = parseAll([text]);
    assert.equal(whole.length, 3);
    for (let i = 0; i <= text.length; i++) {
      assert.deepEqual(parseAll([text.slice(0, i), text.slice(i)]), whole, `Schnitt bei ${i}`);
    }
  }
});

test('garbage is skipped and the buffer stays bounded', () => {
  const good = item('core', 'minm', 'Weites Land');
  const items = parseAll(['Rauschen </item> <ite', 'm><type>zz</type></item>\n', '<item><type>73736e63</type><code>70', good, '\x00\xff<<>>']);
  assert.deepEqual(
    items.map((found) => found.data.toString()),
    ['Weites Land'],
  );

  // Text without any item is dropped up to a possible "<item" at the end
  const parser = new MetadataParser(() => {});
  parser.push('x'.repeat(100_000));
  assert.ok(parser.buffered <= 5);

  // An item that never ends is dropped once it passes the cap
  const seen = [];
  const capped = new MetadataParser((found) => seen.push(found.code), { maxBuffer: 1000 });
  capped.push('<item><type>73736e63</type><code>50494354</code><length>99999</length>\n<data encoding="base64">\n');
  for (let i = 0; i < 20; i++) {
    capped.push('A'.repeat(500));
    assert.ok(capped.buffered <= 1500, `Puffer ${capped.buffered}`);
  }
  capped.push('</data></item>\n');
  capped.push(item('ssnc', 'pbeg'));
  assert.deepEqual(seen, ['pbeg']);
});

/* ---------- payloads ---------- */

test('progress: RTP frames at 44.1 kHz become seconds', () => {
  assert.deepEqual(parseProgress('1000000/1441000/10790200'), { position: 10, duration: 222 });
  // The 32-bit frame counter wraps around during the track
  const start = 2 ** 32 - 44100;
  assert.deepEqual(parseProgress(`${start}/44100/${100 * 44100 - 44100}`), { position: 2, duration: 100 });
  assert.deepEqual(parseProgress('1000/900/45100'), { position: 0, duration: 1 }, 'just before the start');
  assert.deepEqual(parseProgress('0/88200/44100'), { position: 1, duration: 1 }, 'past the end');
  assert.deepEqual(parseProgress('0/44100/4294967295'), { position: 1, duration: null }, 'stream without end');
  assert.equal(parseProgress('1/2'), null);
  assert.equal(parseProgress('a/b/c'), null);
});

test('volume: AirPlay -30 … 0 dB becomes 0 … 1, -144 is muted', () => {
  assert.equal(parseVolume('-144.00,-96.30,-96.30,0.00'), 0);
  assert.equal(parseVolume('-30.00,-96.30,-96.30,0.00'), 0);
  assert.equal(parseVolume('-15.00,-48.75,-96.30,0.00'), 0.5);
  assert.equal(parseVolume('-7.50,-24.00,-96.30,0.00'), 0.75);
  assert.equal(parseVolume('0.00,0.00,-96.30,0.00'), 1);
  assert.equal(parseVolume('-40,0,0,0'), 0);
  assert.equal(parseVolume('laut'), null);
});

test('covers: JPEG and PNG by magic bytes, nothing else, nothing huge', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(jpeg), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('GIF89a')), null);
  assert.equal(coverDataUrl(PNG), `data:image/png;base64,${PNG.toString('base64')}`);
  assert.match(coverDataUrl(jpeg), /^data:image\/jpeg;base64,\/9j\//);
  const huge = Buffer.alloc(MAX_COVER_BYTES + 1);
  jpeg.copy(huge);
  assert.equal(coverDataUrl(huge), null);
});

/* ---------- state machine ---------- */

test('a play session from the stream becomes the player state', () => {
  const { clock, changes, state, feed } = player();
  feed(stream);
  assert.deepEqual(state.state, {
    active: true,
    playing: true,
    title: 'Weites Land',
    artist: 'Beispiel-Künstlerin',
    album: 'Demo-Album',
    source: 'Pauls iPhone',
    coverUrl: `data:image/png;base64,${PNG.toString('base64')}`,
    position: 10,
    duration: 222,
    positionAt: clock.now(),
    volume: 0.5,
  });
  // Every change is a new object, so the hub notices it
  assert.ok(changes.length >= 4);
  for (let i = 1; i < changes.length; i++) assert.notEqual(changes[i], changes[i - 1]);
  assert.deepEqual(changes.at(-1), state.state);
  // The browser's extrapolation agrees five seconds later
  clock.advance(5000);
  assert.equal(progressAt(state.state, clock.now()), 15);
});

test('pause, resume, end and the timed switches to inactive', () => {
  const { clock, changes, state, feed } = player();
  feed(stream);
  clock.advance(5000);

  feed(item('ssnc', 'pfls'));
  assert.equal(state.state.playing, false);
  assert.equal(state.state.active, true);
  assert.equal(state.state.position, 15, 'frozen where it paused');
  clock.advance(60_000);
  assert.equal(progressAt(state.state, clock.now()), 15, 'no progress while paused');
  clock.advance(PAUSE_TIMEOUT_MS - 60_001);
  assert.equal(state.state.active, true);
  clock.advance(1);
  assert.equal(state.state.active, false, 'paused for five minutes');
  assert.equal(changes.at(-1).active, false, 'the timed switch is published');

  feed(item('ssnc', 'prsm'));
  assert.equal(state.state.active, true);
  assert.equal(state.state.playing, true);
  assert.equal(state.state.positionAt, clock.now());
  clock.advance(2000);
  assert.equal(progressAt(state.state, clock.now()), 17);

  feed(item('ssnc', 'pend'));
  assert.equal(state.state.playing, false);
  assert.equal(state.state.active, true);
  clock.advance(END_DELAY_MS - 1);
  assert.equal(state.state.active, true);
  clock.advance(1);
  assert.deepEqual(state.state, { ...inactiveState(), volume: 0.5 }, 'three seconds after the end');
  assert.equal(changes.at(-1).active, false);

  // Metadata after the end does not bring music mode back, a new session does
  feed(item('ssnc', 'mdst'), item('core', 'minm', 'Nachzügler'), item('ssnc', 'mden'));
  assert.equal(state.state.active, false);
  feed(item('ssnc', 'pbeg'));
  assert.equal(state.state.active, true);
});

test('a new track drops the old cover unless its own arrives', () => {
  const { clock, changes, state, feed } = player();
  feed(stream);
  clock.advance(30_000);
  const bundle = (title, ...extra) => [item('ssnc', 'mdst'), item('core', 'minm', title), item('core', 'asar', 'Beispiel-Band'), ...extra, item('ssnc', 'mden')];

  feed(...bundle('Nachtfahrt'));
  assert.equal(state.state.title, 'Nachtfahrt');
  assert.equal(state.state.album, '', 'missing in the bundle: unknown');
  assert.equal(state.state.coverUrl, null);
  assert.equal(state.state.position, null, 'old progress belongs to the old track');
  feed(item('ssnc', 'PICT', PNG));
  assert.match(state.state.coverUrl, /^data:image\/png/);

  feed(...bundle('Morgenrot', item('ssnc', 'PICT', PNG)));
  assert.equal(state.state.title, 'Morgenrot');
  assert.match(state.state.coverUrl, /^data:image\/png/, 'cover came with the bundle');

  // Progress that arrived just before the metadata is kept
  feed(item('ssnc', 'prgr', '0/441000/4410000'), ...bundle('Abendlicht'));
  assert.equal(state.state.position, 10);

  const count = changes.length;
  feed(...bundle('Abendlicht'));
  assert.equal(changes.length, count, 'the same metadata again changes nothing');

  // Skipping while paused: the next track plays
  feed(item('ssnc', 'pfls'));
  assert.equal(state.state.playing, false);
  feed(...bundle('Weiter'));
  assert.equal(state.state.playing, true);

  // An oversized or unknown picture is ignored, an empty one means no cover
  feed(item('ssnc', 'PICT', PNG));
  feed(item('ssnc', 'PICT', Buffer.from('GIF89a......')));
  assert.match(state.state.coverUrl, /^data:image\/png/);
  feed(item('ssnc', 'PICT'));
  assert.equal(state.state.coverUrl, null);
});

/* ---------- front end: layout, progress, colour ---------- */

test('music mode keeps weather, commute, home and services in the right column', () => {
  const rects = musicRects(DEFAULT_LAYOUT);
  assert.equal(rects.size, DEFAULT_LAYOUT.tiles.length);
  assert.deepEqual(rects.get('wetter'), [1336, 80, 488, 290]);
  assert.deepEqual(rects.get('weg'), [1336, 394, 232, 290]);
  assert.deepEqual(rects.get('home'), [1592, 394, 232, 290]);
  assert.deepEqual(rects.get('dienste'), [1336, 708, 488, 290]);
  for (const id of ['fotos', 'kal', 'todo', 'server']) assert.equal(rects.get(id), null, id);
  // Narrower than in normal mode, and right of the player (x 96 … 1276)
  for (const tile of DEFAULT_LAYOUT.tiles) {
    const rect = rects.get(tile.id);
    if (!rect) continue;
    assert.ok(rect[2] < rectFor(tile)[2], `${tile.id} schmaler`);
    assert.ok(rect[0] > 1276 && rect[0] + rect[2] <= 1920 - 96, `${tile.id} rechts`);
  }
  assert.deepEqual([...SLOTS.wide, ...SLOTS.small].length, 4);
});

test('music mode fills the slots with other tiles when the preferred ones are gone', () => {
  const layout = { tiles: DEFAULT_LAYOUT.tiles.filter((tile) => !['wetter', 'weg'].includes(tile.id)), hidden: ['wetter', 'weg'] };
  const rects = musicRects(layout);
  assert.deepEqual(rects.get('dienste'), SLOTS.wide[0]);
  assert.deepEqual(rects.get('kal'), SLOTS.wide[1], 'first other wide tile');
  assert.deepEqual(rects.get('home'), SLOTS.small[0]);
  assert.deepEqual(rects.get('fotos'), SLOTS.small[1], 'first other small tile');
  assert.equal(rects.get('wetter'), null);
  assert.equal(rects.get('todo'), null);
  assert.equal(rects.get('server'), null);
  assert.deepEqual(musicRects({ tiles: [] }), new Map());
  assert.deepEqual(musicRects(undefined), new Map());
});

test('progress display: extrapolated while playing, still while paused', () => {
  const at = 1_000_000;
  assert.equal(progressAt({ position: 10, duration: 222, positionAt: at, playing: true }, at + 2500), 12.5);
  assert.equal(progressAt({ position: 10, duration: 222, positionAt: at, playing: false }, at + 2500), 10);
  assert.equal(progressAt({ position: 220, duration: 222, positionAt: at, playing: true }, at + 60_000), 222);
  assert.equal(progressAt({ position: 5, duration: null, positionAt: at, playing: true }, at + 1000), 6);
  assert.equal(progressAt({ position: 10, duration: 222, positionAt: at, playing: true }, at - 5000), 10, 'clock skew');
  assert.equal(progressAt({ position: null }, at), null);
  assert.equal(progressAt(null, at), null);
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(61.9), '1:01');
  assert.equal(formatTime(222), '3:42');
  assert.equal(formatTime(3725), '62:05');
});

test('glow colour: saturated pixels win, then brightened', () => {
  const pixels = (...rgba) => Uint8ClampedArray.from(rgba.flat());
  assert.deepEqual(averageColour(pixels([255, 0, 0, 255], [200, 0, 0, 255])), [225, 0, 0]);
  // Ten grey pixels and one orange: the orange pulls hard
  const mix = averageColour(pixels(...Array(10).fill([128, 128, 128, 255]), [255, 120, 0, 255]));
  assert.ok(mix[0] > mix[2] + 40, `orange: ${mix}`);
  assert.equal(averageColour(pixels([255, 0, 0, 0])), null, 'transparent');
  assert.deepEqual(brighten([100, 50, 0]), [225, 113, 0]);
  assert.deepEqual(brighten([0, 0, 0]), [0, 0, 0]);
});

/* ---------- the pipe ---------- */

test('a real FIFO: writers come and go, a replaced pipe is reopened', onLinux, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dash-music-'));
  const path = join(dir, 'metadata');
  execFileSync('mkfifo', [path]);
  const source = createShairportSource({ path, log: quiet, retryMs: 50 });
  try {
    source.start();
    assert.equal(source.connected, true);
    await writeTo(path, stream.toString('latin1'));
    await waitFor(() => source.state.position === 10, 'Fixture gelesen');
    assert.equal(source.state.title, 'Weites Land');
    assert.match(source.state.coverUrl, /^data:image\/png/);

    // The first writer is gone; a second one still gets through
    await writeTo(path, item('ssnc', 'pfls'));
    await waitFor(() => source.state.playing === false, 'pfls gelesen');

    // shairport-sync restarted and created a new pipe at the same place
    unlinkSync(path);
    execFileSync('mkfifo', [path]);
    await writeTo(path, item('ssnc', 'prsm'));
    await waitFor(() => source.state.playing === true, 'prsm aus der neuen Pipe');
  } finally {
    source.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(source.connected, false);
});

test('a missing pipe is retried and reported once, a plain file is refused', onLinux, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dash-music-'));
  const path = join(dir, 'metadata');
  const warnings = [];
  const log = { warn: (message) => warnings.push(message), log() {} };
  const chunks = [];
  const reader = createPipeReader({ path, log, retryMs: 20, onData: (chunk) => chunks.push(String(chunk)) });
  const file = join(dir, 'datei');
  writeFileSync(file, 'keine Pipe');
  const plain = createPipeReader({ path: file, log, retryMs: 20, onData: () => assert.fail('read a plain file') });
  try {
    reader.start();
    await sleep(150);
    assert.equal(reader.connected, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /fehlt/);

    execFileSync('mkfifo', [path]);
    await waitFor(() => reader.connected, 'Pipe gefunden');
    await writeTo(path, 'hallo');
    await waitFor(() => chunks.join('') === 'hallo', 'Daten gelesen');

    plain.start();
    await sleep(100);
    assert.equal(plain.connected, false);
    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /keine Named Pipe/);
  } finally {
    reader.stop();
    plain.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- the widget ---------- */

test('widget: the hub publishes every change from the pipe', onLinux, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dash-music-'));
  const path = join(dir, 'metadata');
  execFileSync('mkfifo', [path]);
  const config = { demo: false, get: (key, fallback) => (key === 'DASH_SHAIRPORT_PIPE' ? path : fallback) };
  const store = { read: async (_, fallback) => fallback, write: async () => {} };
  const hub = new Hub({ widgets: [music], config, store, log: quiet });
  const seen = [];
  hub.subscribe((entry) => seen.push(entry.data));
  try {
    hub.start();
    await waitFor(() => seen.length > 0, 'erster Stand');
    assert.deepEqual(seen[0], inactiveState());
    await writeTo(path, stream.toString('latin1'));
    await waitFor(() => seen.at(-1)?.position === 10, 'Stand aus der Pipe');
    assert.ok(seen.some((data) => data.active && data.title === 'Weites Land' && !data.coverUrl), 'cover follows later');
    assert.deepEqual(await music.fetch(hub.ctx), seen.at(-1), 'fetch() repeats the current state');
  } finally {
    hub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(await music.fetch(hub.ctx), inactiveState(), 'stopped: inactive');
});

test('widget: no reader, no pipe, no crash', async () => {
  assert.deepEqual(await music.fetch({}), inactiveState());
  assert.equal(music.isConfigured({}), true);
  const ctx = { config: { get: (key, fallback) => (key === 'DASH_SHAIRPORT_PIPE' ? '/nonexistent/shairport' : fallback) }, log: quiet };
  const stop = music.watch(ctx, () => assert.fail('nothing to publish'));
  assert.deepEqual(await music.fetch(ctx), inactiveState());
  stop();
});

test('demo data has the same shape as real data', () => {
  const real = player();
  real.feed(stream);
  const config = { get: (key, fallback) => (key === 'DASH_DEMO_MUSIC' ? '1' : fallback) };
  const at = new Date('2026-10-16T20:15:00+02:00');
  const demo = music.demo({ config, now: () => at });
  const shape = (value) => (value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])])) : typeof value);
  assert.deepEqual(shape(demo), shape(real.state.state));
  assert.equal(demo.active && demo.playing, true);
  assert.equal(demo.title, 'Weites Land');
  assert.equal(demo.positionAt, at.getTime());
  assert.ok(demo.position >= 0 && demo.position < demo.duration);
  assert.match(Buffer.from(DEMO_COVER.split(',')[1], 'base64').toString(), /^<svg[^>]+viewBox="0 0 600 600"/);
  assert.equal(demo.coverUrl, DEMO_COVER);

  // The position follows the clock and starts over at the end
  const later = music.demo({ config, now: () => new Date(at.getTime() + 10_000) });
  assert.equal(Math.round(((later.position - demo.position + 222) % 222) * 1000) / 1000, 10);
  const positions = Array.from({ length: 30 }, (_, i) => music.demo({ config, now: () => new Date(at.getTime() + i * 20_000) }).position);
  assert.ok(positions.every((p) => p >= 0 && p < 222));
  assert.ok(positions.some((p, i) => i > 0 && p < positions[i - 1]), 'wraps around');

  // Without DASH_DEMO_MUSIC the demo stays quiet
  assert.deepEqual(music.demo({ config: { get: (_, fallback) => fallback }, now: () => at }), inactiveState());
  assert.deepEqual(music.demo({ config: { place: 'Hamburg' } }), inactiveState(), 'config without get()');
});
