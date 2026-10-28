import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listBackgrounds, SCENES } from '../server/backgrounds.js';
import { clipsFor, createScenes, dayNumber, PER_DAY, sceneAt } from '../web/js/scene.js';

const LIST = new URL('../scripts/backgrounds.txt', import.meta.url);

test('the pool is what fetch-backgrounds.sh left in the media folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'media-'));
  try {
    for (const file of ['tag-50180.mp4', 'tag-50180.jpg', 'morgen-2793.mp4', 'tag-4132.mp4', 'spaet-42342.mp4']) writeFileSync(join(dir, file), '');
    // Old fixed names, a poster without its clip, foreign files: not part of it
    for (const file of ['tag.mp4', 'nacht.mp4', 'abend-5002.jpg', 'urlaub.mp4', 'nacht-1.mp4', 'tag-1.mov']) writeFileSync(join(dir, file), '');
    assert.deepEqual(await listBackgrounds(dir), {
      morgen: ['morgen-2793'],
      tag: ['tag-4132', 'tag-50180'],
      abend: [],
      spaet: ['spaet-42342'],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(await listBackgrounds(join(tmpdir(), 'gibt-es-nicht-7f3a')), { morgen: [], tag: [], abend: [], spaet: [] });
});

test('backgrounds.txt: known scenes, every clip once, enough to change daily', () => {
  const lines = readFileSync(LIST, 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'));
  const ids = new Set();
  const count = Object.fromEntries(SCENES.map((scene) => [scene, 0]));
  for (const line of lines) {
    const [scene, id, ...words] = line.trim().split(/\s+/);
    assert.ok(SCENES.includes(scene), `Szene ${scene}`);
    assert.match(id, /^\d+$/);
    assert.ok(!ids.has(id), `${id} doppelt`);
    assert.ok(words.length, `${id} ohne Beschreibung`);
    ids.add(id);
    count[scene] += 1;
  }
  for (const scene of SCENES) assert.ok(count[scene] > PER_DAY, `${scene}: ${count[scene]} Clips`);
});

test('two clips per scene a day, the next two tomorrow, all of them over the days', () => {
  const tag = ['tag-1', 'tag-2', 'tag-3', 'tag-4', 'tag-5'];
  const pool = { tag, abend: ['abend-1'] };
  const day = dayNumber(2026, 10, 23);
  assert.equal(clipsFor(pool, 'tag', day).length, PER_DAY);
  assert.deepEqual(clipsFor(pool, 'tag', day), clipsFor(pool, 'tag', day), 'the same all day');
  assert.notDeepEqual(clipsFor(pool, 'tag', day), clipsFor(pool, 'tag', day + 1));
  const seen = new Set();
  for (let d = day; d < day + Math.ceil(tag.length / PER_DAY); d++) clipsFor(pool, 'tag', d).forEach((clip) => seen.add(clip));
  assert.equal(seen.size, tag.length);
  assert.deepEqual(clipsFor(pool, 'abend', day), ['abend-1'], 'a small pool plays whole');
  assert.deepEqual(clipsFor(pool, 'morgen', day), []);
  assert.deepEqual(clipsFor(undefined, 'tag', day), []);
  assert.equal(clipsFor(pool, 'tag', -3).length, PER_DAY);
});

test('day numbers follow the calendar, not the clock', () => {
  assert.equal(dayNumber(1970, 1, 1), 0);
  assert.equal(dayNumber(2026, 10, 25) - dayNumber(2026, 10, 24), 1, 'across the switch to winter time');
  assert.equal(dayNumber(2027, 1, 1) - dayNumber(2026, 12, 31), 1);
});

test('scenes by time of day', () => {
  const sun = { sunrise: '07:46', sunset: '18:24' };
  assert.equal(sceneAt(3 * 60, sun), 'spaet');
  assert.equal(sceneAt(8 * 60, sun), 'morgen');
  assert.equal(sceneAt(13 * 60, sun), 'tag');
  assert.equal(sceneAt(18 * 60, sun), 'abend');
  assert.equal(sceneAt(18 * 60 + 50, sun), 'abend', 'until half an hour after sunset');
  assert.equal(sceneAt(18 * 60 + 54, sun), 'spaet', 'then the city lights');
  assert.equal(sceneAt(23 * 60, sun), 'spaet');
  // Late October: dark by five
  assert.equal(sceneAt(17 * 60 + 30, { sunrise: '07:15', sunset: '16:56' }), 'spaet');
  // Midsummer: still light at ten, city lights from 22:30 at the latest
  assert.equal(sceneAt(22 * 60, { sunrise: '04:50', sunset: '21:55' }), 'abend');
  assert.equal(sceneAt(22 * 60 + 30, { sunrise: '04:50', sunset: '21:55' }), 'spaet');
});

function fakeVideo() {
  const classes = new Set();
  const attributes = {};
  return {
    poster: '',
    muted: false,
    paused: true,
    played: [],
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    get on() {
      return classes.has('on');
    },
    get src() {
      return attributes.src ?? '';
    },
    set src(value) {
      attributes.src = value;
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    load() {},
    pause() {
      this.paused = true;
    },
    play() {
      this.paused = false;
      this.played.push(this.src);
      return Promise.resolve();
    },
  };
}

test('one video decodes at a time; videos off leave the still picture', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const v1 = fakeVideo();
  const v2 = fakeVideo();
  const stage = { dataset: {}, querySelector: (selector) => (selector === '#v1' ? v1 : v2) };
  const scenes = createScenes(stage);
  const pool = { tag: ['tag-1', 'tag-2', 'tag-3', 'tag-4'] };
  const day = dayNumber(2026, 10, 23);
  const [first, second] = clipsFor(pool, 'tag', day);

  scenes.set('tag', day);
  assert.equal(stage.dataset.scene, 'tag');
  assert.equal(v1.src + v2.src, '', 'no clips yet: the gradient');
  scenes.setPool(pool);
  await Promise.resolve();
  assert.equal(v2.src, `/media/${first}.mp4`);
  assert.ok(v2.on && !v1.on);

  t.mock.timers.tick(2000);
  assert.ok(v1.paused && v1.src === '', 'the hidden video lets go of its decoder');

  t.mock.timers.tick(60_000);
  await Promise.resolve();
  assert.equal(v1.src, `/media/${second}.mp4`, 'the day’s clips take turns');
  assert.ok(v1.on && !v2.on);

  scenes.setVideos(false);
  assert.ok(v1.paused && v2.paused && v1.src === '' && v2.src === '', 'nothing decodes');
  assert.equal(v1.poster, `/media/${second}.jpg`);
  assert.ok(v1.on, 'the picture of the clip stays');
  t.mock.timers.tick(60_000);
  assert.equal(v1.src + v2.src, '', 'no turns while off');

  scenes.setVideos(true);
  await Promise.resolve();
  assert.equal(v2.src, `/media/${second}.mp4`);

  // A new day keeps a clip that is still among the chosen, else switches
  const playedBefore = v1.played.length + v2.played.length;
  assert.ok(clipsFor(pool, 'tag', day + 2).includes(second));
  scenes.set('tag', day + 2);
  await Promise.resolve();
  assert.equal(v1.played.length + v2.played.length, playedBefore);
  const [next] = clipsFor(pool, 'tag', day + 3);
  assert.notEqual(next, second);
  scenes.set('tag', day + 3);
  await Promise.resolve();
  assert.equal(v1.src, `/media/${next}.mp4`);

  scenes.set('nacht', day + 2);
  assert.equal(v1.src + v2.src, '', 'the night clock has no video');
  assert.ok(!v1.on && !v2.on);
});

test('a clip that loses its connection while showing comes back, a missing one does not', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const v1 = fakeVideo();
  const v2 = fakeVideo();
  const stage = { dataset: {}, querySelector: (selector) => (selector === '#v1' ? v1 : v2) };
  const scenes = createScenes(stage);
  scenes.setPool({ tag: ['tag-1', 'tag-2', 'tag-3'] });
  scenes.set('tag', dayNumber(2026, 10, 28));
  await Promise.resolve();
  const shown = v2.on ? v2 : v1;
  const clip = shown.src;
  t.mock.timers.tick(2000);

  // The dashboard restarts: the showing video reports an error
  shown.onerror();
  assert.ok(!v1.on && !v2.on, 'for a moment the gradient');
  t.mock.timers.tick(5000);
  await Promise.resolve();
  const back = v1.on ? v1 : v2;
  assert.ok(back.on, 'the clip is back');
  assert.equal(back.src, clip, 'the same clip');

  // A clip that never showed (file missing) is not tried again and again
  const before = v1.played.length + v2.played.length;
  const hidden = back === v1 ? v2 : v1;
  hidden.src = '/media/tag-404.mp4';
  hidden.onerror();
  t.mock.timers.tick(5000);
  await Promise.resolve();
  assert.equal(v1.played.length + v2.played.length, before);
});
