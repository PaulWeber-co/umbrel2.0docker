// Minifunk: little messages for the wall from the Knuddl app
// (github.com/PaulWeber-co/DynamicChicken). One of you writes a sentence, a
// list or a note in the app, optionally with one photo a day, and it appears
// on the XPS in the free space under the clock while no music plays: text in
// a glass card sized to its length, a photo where the cover would be with the
// words above it. Nothing goes to the other phone; the wall is the mailbox.
//
// The XPS joins the couple's encrypted Firebase room with the invitation's
// secret (server/knuddl.js) and
//   - publishes x/status every minute and on every change: whether the
//     dashboard is on (the app only offers Minifunk then), whether music
//     plays, and who already sent today's photo;
//   - fetches x/funk on every change of the live stream (and once a minute),
//     keeps each message here and deletes it from the database at once.
//
// Rules enforced here, whatever the app does: text up to 500 characters,
// photos only as JPEG up to 1.5 MB, one photo per sender and day (the XPS's
// day); text stays DASH_MINIFUNK_HOURS (24), a photo DASH_MINIFUNK_PHOTO_HOURS
// (6), then the file is deleted. A tap on × on the wall removes a message.
//
// Settings:
//   DASH_KNUDDL_INVITE   the invitation from Knuddl → Mehr → Verbindung (secret!)
//   DASH_KNUDDL_URL      the Firebase database, like cloudUrl in Knuddl's config.js
//   DASH_KNUDDL_NAMESPACE  only if changed in Knuddl's config.js (knuddl)
//   DASH_MINIFUNK_HOURS, DASH_MINIFUNK_PHOTO_HOURS
//   DASH_DEMO_FUNK       demo mode: text (default), photo, both or off
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectRoom, secretFromInvite } from '../knuddl.js';

const STATE = 'minifunk.json';
export const MAX_TEXT = 500;
export const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
const MAX_ITEMS = 12;
const MAX_SEEN = 100;
const MAX_AGE_MS = 24 * 3_600_000; // older messages that waited in the database are dropped
const STATUS_MS = 60_000;
const CHECK_MS = 10_000;
const RETRY_MS = [5_000, 15_000, 60_000, 300_000];

const HOUR = 3_600_000;
const CODE = /^[A-Z0-9]{6}$/;
export const PHOTO_ID = /^[a-f0-9]{16}$/;

// The day of an instant in the dashboard's time zone, "2026-10-23"
export const dayOf = (ms, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

const settings = (config) => ({
  textHours: Math.min(168, Math.max(1, config.num?.('DASH_MINIFUNK_HOURS', 24) ?? 24)),
  photoHours: Math.min(48, Math.max(1, config.num?.('DASH_MINIFUNK_PHOTO_HOURS', 6) ?? 6)),
});

const cleanLine = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// "Milch\n\n\n\nEier  " → "Milch\n\nEier": at most one empty line, 12 lines
export function cleanText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split('\n')
    .slice(0, 12)
    .join('\n')
    .slice(0, MAX_TEXT);
}

// A decrypted record from the app → a clean message, or null to drop it.
export function validateFunk(message, now) {
  if (!message || typeof message !== 'object' || message.t !== 'funk') return null;
  const at = Number(message.at);
  if (!Number.isFinite(at) || at < now - MAX_AGE_MS || at > now + 5 * 60_000) return null;
  const from = String(message.from ?? '');
  if (!CODE.test(from)) return null;
  const text = cleanText(message.text);
  let photo = null;
  if (typeof message.photo === 'string' && message.photo) {
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(message.photo);
    const bytes = match ? Buffer.from(match[1], 'base64') : null;
    // Only real JPEGs (FF D8 FF) of sane size are ever written to disk
    if (bytes && bytes.length <= MAX_PHOTO_BYTES && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) photo = bytes;
  }
  if (!text && !photo) return null;
  return {
    id: cleanLine(message.id, 64) || null,
    from,
    name: cleanLine(message.name, 40) || cleanLine(message.pet, 40) || 'Dein Knuddl',
    text,
    photo,
    at,
  };
}

export const emptyState = () => ({ items: [], photoDay: {}, seen: [] });

function normalizeState(saved) {
  const state = emptyState();
  if (!saved || typeof saved !== 'object') return state;
  if (Array.isArray(saved.items)) state.items = saved.items.filter((item) => item && typeof item.id === 'string' && PHOTO_ID.test(item.id));
  if (saved.photoDay && typeof saved.photoDay === 'object') {
    for (const [code, day] of Object.entries(saved.photoDay)) if (CODE.test(code) && typeof day === 'string') state.photoDay[code] = day;
  }
  if (Array.isArray(saved.seen)) state.seen = saved.seen.filter((id) => typeof id === 'string').slice(-MAX_SEEN);
  return state;
}

// Puts a validated message into the state. One photo per sender and day:
// a second one is dropped, its text still shows.
// → { state, item, photoAccepted, removedPhotos } (files of items pushed out)
export function acceptFunk(state, funk, { now, timeZone, textHours = 24, photoHours = 6, id = randomBytes(8).toString('hex') }) {
  const today = dayOf(now, timeZone);
  const photoAccepted = Boolean(funk.photo) && state.photoDay[funk.from] !== today;
  if (!funk.text && !photoAccepted) return { state, item: null, photoAccepted: false, removedPhotos: [] };
  const item = {
    id,
    from: funk.from,
    name: funk.name,
    text: funk.text,
    at: funk.at,
    receivedAt: now,
    until: now + (funk.text ? textHours : photoHours) * HOUR,
    photoUntil: photoAccepted ? now + photoHours * HOUR : null,
  };
  const items = [item, ...state.items];
  const next = {
    items: items.slice(0, MAX_ITEMS),
    photoDay: photoAccepted ? { ...state.photoDay, [funk.from]: today } : state.photoDay,
    seen: funk.id ? [...state.seen, funk.id].slice(-MAX_SEEN) : state.seen,
  };
  const removedPhotos = items.slice(MAX_ITEMS).filter((old) => old.photoUntil).map((old) => old.id);
  return { state: next, item, photoAccepted, removedPhotos };
}

const textAlive = (item, now) => Boolean(item.text) && item.until > now;

// Drops what has run out: a photo after its hours (the text may stay
// longer), a message when nothing of it is left.
// → { state, removedPhotos: [id] } (files to delete)
export function prune(state, now) {
  const removedPhotos = [];
  const items = [];
  for (const item of state.items) {
    let photoUntil = item.photoUntil ?? null;
    if (photoUntil && photoUntil <= now) {
      removedPhotos.push(item.id);
      photoUntil = null;
    }
    if (!photoUntil && !textAlive(item, now)) continue;
    items.push(photoUntil === item.photoUntil ? item : { ...item, photoUntil });
  }
  return { state: { ...state, items }, removedPhotos };
}

// What the browsers get: newest first, photos as a URL on this dashboard
export function toWidgetData(state, now, { enabled = true } = {}) {
  return {
    enabled,
    items: state.items
      .filter((item) => textAlive(item, now) || item.photoUntil > now)
      .map((item) => ({
        id: item.id,
        name: item.name,
        text: item.text,
        at: item.at,
        photo: item.photoUntil > now ? `/api/minifunk/${item.id}.jpg` : null,
      })),
  };
}

// What the app reads in x/status
export function wallStatus({ display, music, state, now, timeZone, photoHours }) {
  return {
    t: 'wall',
    v: 1,
    at: now,
    display,
    available: display === 'on',
    music: Boolean(music),
    today: dayOf(now, timeZone),
    photoDay: state.photoDay,
    maxText: MAX_TEXT,
    photoHours,
  };
}

/* ---------- running it ---------- */

const runners = new WeakMap(); // per store: the live connection and state

const photoDir = (ctx) => join(ctx.store.dir ?? ctx.config.dataDir, 'minifunk');

async function deletePhotos(ctx, ids) {
  for (const id of ids) {
    if (PHOTO_ID.test(id)) await rm(join(photoDir(ctx), `${id}.jpg`), { force: true }).catch(() => {});
  }
}

async function loadState(ctx) {
  return normalizeState(await ctx.store.read(STATE, null));
}

function createRunner(ctx, emit) {
  const { config, log } = ctx;
  const timeZone = config.timezone;
  const { textHours, photoHours } = settings(config);
  const abort = new AbortController();
  let room = null;
  let state = emptyState();
  let lastStatus = '';
  let statusAt = 0;
  let work = Promise.resolve();
  let failures = 0;
  const timers = [];

  const serial = (task) => {
    work = work.then(task).catch((error) => log.warn(`[minifunk] ${error.message}`));
    return work;
  };

  async function save() {
    await ctx.store.write(STATE, state);
    emit(toWidgetData(state, Date.now()));
  }

  async function publish(force = false) {
    if (!room) return;
    const host = await ctx.store.read('host-state.json', null);
    const status = wallStatus({ display: host?.display ?? 'on', music: ctx.peek?.('music')?.active, state, now: Date.now(), timeZone, photoHours });
    const key = JSON.stringify({ ...status, at: 0 });
    if (!force && key === lastStatus && Date.now() - statusAt < STATUS_MS) return;
    await room.writeStatus(status);
    lastStatus = key;
    statusAt = Date.now();
  }

  async function collect() {
    if (!room) return;
    const records = await room.readFunks();
    let changed = false;
    for (const { key, message } of records) {
      const now = Date.now();
      // Undecryptable, invalid, too old or seen before: dropped
      const funk = validateFunk(message, now);
      if (funk && !(funk.id && state.seen.includes(funk.id))) {
        const result = acceptFunk(state, funk, { now, timeZone, textHours, photoHours });
        if (result.item) {
          // Written before the record is deleted: a failed write is retried
          if (result.photoAccepted) {
            await mkdir(photoDir(ctx), { recursive: true, mode: 0o750 });
            await writeFile(join(photoDir(ctx), `${result.item.id}.jpg`), funk.photo, { mode: 0o640 });
          }
          state = result.state;
          changed = true;
          await deletePhotos(ctx, result.removedPhotos);
          log.log?.(`[minifunk] ${funk.name} hat gefunkt${result.photoAccepted ? ' (mit Foto)' : funk.photo ? ' (Foto heute schon da, nur Text)' : ''}`);
        }
      }
      // On the XPS now, or not ours to keep: either way out of the database
      await room.deleteFunk(key);
    }
    if (changed) {
      await save();
      await publish(true); // the photo of the day is taken
    }
  }

  async function tidy() {
    const result = prune(state, Date.now());
    if (result.removedPhotos.length || result.state.items.length !== state.items.length) {
      state = result.state;
      await deletePhotos(ctx, result.removedPhotos);
      await save();
    }
  }

  async function connect() {
    const secret = secretFromInvite(config.get('DASH_KNUDDL_INVITE'));
    if (!secret) throw new Error('DASH_KNUDDL_INVITE ist keine Knuddl-Einladung');
    room = await connectRoom({
      url: config.get('DASH_KNUDDL_URL'),
      namespace: config.get('DASH_KNUDDL_NAMESPACE', 'knuddl'),
      secret,
      fetchJson: ctx.fetchJson,
    });
    log.log?.('[minifunk] verbunden mit dem Knuddl-Raum');
  }

  // The live stream; when it breaks, wait a little longer each time
  async function streamLoop() {
    while (!abort.signal.aborted) {
      try {
        if (!room) await serial(connect);
        if (!room) throw new Error('keine Verbindung');
        await serial(() => publish(true));
        await serial(collect);
        await room.watchFunks(() => serial(collect), abort.signal);
        failures = 0;
      } catch (error) {
        if (abort.signal.aborted) return;
        if (failures === 0) log.warn(`[minifunk] ${error.message}`);
        failures++;
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
        timer.unref?.();
      });
    }
  }

  return {
    get state() {
      return state;
    },
    async start() {
      state = await loadState(ctx);
      await tidy();
      emit(toWidgetData(state, Date.now()));
      streamLoop();
      timers.push(setInterval(() => serial(() => publish(false)), CHECK_MS));
      timers.push(setInterval(() => serial(collect).then(() => serial(tidy)), 60_000));
      for (const timer of timers) timer.unref?.();
    },
    stop() {
      abort.abort();
      for (const timer of timers.splice(0)) clearInterval(timer);
    },
    async dismiss(id) {
      await serial(async () => {
        const before = state.items.length;
        state = { ...state, items: state.items.filter((item) => item.id !== id) };
        if (state.items.length !== before) {
          await deletePhotos(ctx, [id]);
          await save();
        }
      });
    },
  };
}

/* ---------- demo ---------- */

const DEMO_PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b37c"/><stop offset=".55" stop-color="#e97a6b"/><stop offset="1" stop-color="#5a4a7a"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#s)"/><circle cx="300" cy="330" r="80" fill="#ffe2a6" opacity=".9"/>
<path d="M0 420 Q150 360 300 410 T600 400 V600 H0Z" fill="#3c3560"/><path d="M0 480 Q200 430 380 470 T600 470 V600 H0Z" fill="#2a2648"/>
</svg>`;
export const DEMO_PHOTO = `data:image/svg+xml;base64,${Buffer.from(DEMO_PHOTO_SVG).toString('base64')}`;

function demoData(config, now) {
  const mode = config.get?.('DASH_DEMO_FUNK', 'text') ?? 'text';
  const items = [];
  if (mode === 'photo' || mode === 'both') {
    items.push({ id: 'demo0000photo001', name: 'Lea', text: 'Sonnenuntergang am Deich – denk an dich!', at: now - 4 * 60_000, photo: DEMO_PHOTO });
  }
  if (mode === 'text' || mode === 'both') {
    items.push({ id: 'demo00000text001', name: 'Lea', text: 'Nicht vergessen:\n- Milch\n- Basilikum\n- Geschenk für Oma', at: now - 25 * 60_000, photo: null });
    items.push({ id: 'demo00000text002', name: 'Paul', text: 'Bin um 19 Uhr zu Hause, ich koche 🍝', at: now - 70 * 60_000, photo: null });
  }
  return { enabled: mode !== 'off', items };
}

export default {
  id: 'minifunk',
  tile: false, // the side column under the clock (web/js/features/minifunk.js)
  intervalMs: 60_000,
  isConfigured: () => true,

  watch(ctx, emit) {
    if (!secretFromInvite(ctx.config.get('DASH_KNUDDL_INVITE')) || !ctx.config.get('DASH_KNUDDL_URL')) return () => {};
    const runner = createRunner(ctx, emit);
    runners.set(ctx.store, runner);
    runner.start().catch((error) => ctx.log.warn(`[minifunk] ${error.message}`));
    return () => {
      runner.stop();
      if (runners.get(ctx.store) === runner) runners.delete(ctx.store);
    };
  },

  async fetch(ctx) {
    const runner = runners.get(ctx.store);
    if (runner) return toWidgetData(runner.state, Date.now());
    const enabled = Boolean(secretFromInvite(ctx.config.get('DASH_KNUDDL_INVITE')) && ctx.config.get('DASH_KNUDDL_URL'));
    return enabled ? toWidgetData(await loadState(ctx), Date.now()) : { enabled: false, items: [] };
  },

  demo: ({ config, now } = {}) => demoData(config, (now?.() ?? new Date()).getTime()),

  actions: {
    async dismiss(ctx) {
      const id = ctx.payload?.id;
      if (typeof id !== 'string' || !/^[a-z0-9]{16}$/.test(id)) throw Object.assign(new Error('Aktion dismiss erwartet { "id": "…" }'), { status: 400 });
      if (ctx.demo) return { id };
      await runners.get(ctx.store)?.dismiss(id);
      return { id };
    },
  },
};
