// To-dos ("Unsere To-dos"): the lists from the Knuddl app
// (github.com/PaulWeber-co/DynamicChicken). After every change the app
// writes one encrypted package to the room's x/liste (src/state/listen.js
// there, listeFuerWand): the open to-dos, the top of the bucket list, your
// names, colours (lila or pink) and votes. The XPS reads it with the Minifunk
// invitation, live through Firebase's stream and once a minute, checks every
// field and keeps the last good package, so a restart without internet still
// shows the list.
//
// The tile shows the open to-dos, the most urgent first, each with a circle
// in the colour of whoever does it. With everything done it shows the bucket
// list instead, one item at a time and the next one every minute, with
// "To-dos erledigt" underneath. A 2×1 tile shows both side by side. Nothing
// is ticked off on the wall: that happens in the app.
//
// Settings: DASH_KNUDDL_INVITE and DASH_KNUDDL_URL, the same as Minifunk
// (server/widgets/minifunk.js).
import { connectRoom, secretFromInvite } from '../knuddl.js';

const FILE = 'knuddl-liste.json';
const CODE = /^[A-Za-z0-9_-]{1,24}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RETRY_MS = [5_000, 15_000, 60_000, 300_000];
const MAX_TODOS = 12;
const MAX_BUCKET = 8;
const runners = new Map();

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const day = (value) => (typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null);

// The app's package → the same shape with only what passed every check, or null
export function validateListe(message) {
  if (!message || typeof message !== 'object' || message.t !== 'liste' || message.v !== 1) return null;
  const at = Number(message.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const leute = (Array.isArray(message.leute) ? message.leute : [])
    .filter((person) => person && CODE.test(person.code))
    .slice(0, 2)
    .map((person) => ({ code: person.code, name: text(person.name, 40) || 'Jemand', farbe: person.farbe === 'pink' ? 'pink' : 'lila' }));
  const codes = new Set(leute.map((person) => person.code));
  const todos = (Array.isArray(message.todos) ? message.todos : [])
    .slice(0, MAX_TODOS)
    .map((todo) => ({ text: text(todo?.text, 120), due: day(todo?.due), who: todo?.who === 'wir' || codes.has(todo?.who) ? todo.who : 'wir' }))
    .filter((todo) => todo.text);
  const bucket = (Array.isArray(message.bucket) ? message.bucket : [])
    .slice(0, MAX_BUCKET)
    .map((item) => ({
      text: text(item?.text, 90),
      stimmen: Object.fromEntries(Object.entries(item?.stimmen && typeof item.stimmen === 'object' ? item.stimmen : {})
        .filter(([code, vote]) => codes.has(code) && [1, 2, 3].includes(vote))),
      einig: item?.einig === true,
      unbedingt: item?.unbedingt === true,
    }))
    .filter((item) => item.text);
  const offen = Number.isInteger(message.offen) && message.offen >= todos.length ? Math.min(message.offen, 999) : todos.length;
  return { t: 'liste', v: 1, at, leute, todos, offen, bucket };
}

// "2026-10-27" in the dashboard's time zone
export function localDay(now, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// When a to-do is due, in words: "heute", "morgen", "Fr", "seit 25. Okt."
export function dueText(due, today) {
  if (!due) return { gruppe: 'ohne', wann: '' };
  const days = daysBetween(today, due);
  const date = new Date(`${due}T12:00:00Z`);
  const short = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
  if (days < 0) return { gruppe: 'ueberfaellig', wann: `seit ${short}` };
  if (days === 0) return { gruppe: 'heute', wann: 'heute' };
  if (days === 1) return { gruppe: 'morgen', wann: 'morgen' };
  if (days < 7) return { gruppe: 'woche', wann: new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: 'UTC' }).format(date).replace('.', '') };
  return { gruppe: 'spaeter', wann: short };
}

// The checked package → what the browsers get: names and colours instead of
// codes, due dates in words, and which bucket item is on show this minute
export function toWidgetData(liste, now, timeZone) {
  if (!liste) return { leer: true, todos: [], offen: 0, bucket: [], fokus: 0 };
  const today = localDay(now, timeZone);
  const person = (code) => (code === 'wir'
    ? { name: 'Zusammen', farbe: 'wir' }
    : { name: liste.leute.find((p) => p.code === code)?.name ?? '', farbe: liste.leute.find((p) => p.code === code)?.farbe ?? 'lila' });
  const todos = liste.todos.map((todo) => ({ text: todo.text, ...dueText(todo.due, today), ...person(todo.who) }));
  const bucket = liste.bucket.map((item) => ({
    text: item.text,
    stimmen: liste.leute.map((p) => ({ name: p.name, farbe: p.farbe, l: item.stimmen[p.code] ?? null })),
    einig: item.einig,
    unbedingt: item.unbedingt,
  }));
  return {
    leer: false,
    todos,
    offen: liste.offen,
    bucket,
    // One bucket item a minute, round and round
    fokus: bucket.length ? Math.floor(now.getTime() / 60_000) % bucket.length : 0,
    at: liste.at,
  };
}

const configured = (config) => Boolean(secretFromInvite(config.get('DASH_KNUDDL_INVITE')) && config.get('DASH_KNUDDL_URL'));

function createRunner(ctx, emit) {
  const { config, log } = ctx;
  const abort = new AbortController();
  let room = null;
  let liste = null;
  let failures = 0;
  let timer = null;

  const now = () => ctx.now?.() ?? new Date();
  const show = () => emit(toWidgetData(liste, now(), config.timezone));

  async function pull() {
    if (!room) return;
    const fresh = validateListe(await room.readListe());
    // Only a newer package replaces the one shown: two phones may write
    if (!fresh || (liste && fresh.at < liste.at)) return;
    const changed = JSON.stringify(fresh) !== JSON.stringify(liste);
    liste = fresh;
    if (changed) {
      await ctx.store.write(FILE, liste);
      log.log?.(`[todo] Listen aus Knuddl: ${liste.offen} offen, ${liste.bucket.length} auf der Bucketlist`);
    }
    show();
  }

  async function connect() {
    room = await connectRoom({
      url: config.get('DASH_KNUDDL_URL'),
      namespace: config.get('DASH_KNUDDL_NAMESPACE', 'knuddl'),
      secret: secretFromInvite(config.get('DASH_KNUDDL_INVITE')),
      fetchJson: ctx.fetchJson,
    });
  }

  async function streamLoop() {
    while (!abort.signal.aborted) {
      try {
        if (!room) await connect();
        await pull();
        await room.watchListe(() => pull().catch((error) => log.warn(`[todo] ${error.message}`)), abort.signal);
        failures = 0;
      } catch (error) {
        if (abort.signal.aborted) return;
        if (failures === 0) log.warn(`[todo] Listen aus Knuddl nicht lesbar: ${error.message}`);
        failures++;
      }
      await new Promise((resolve) => {
        const wait = setTimeout(resolve, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
        wait.unref?.();
      });
    }
  }

  return {
    get liste() {
      return liste;
    },
    pull,
    async start() {
      liste = validateListe(await ctx.store.read(FILE, null));
      show();
      streamLoop();
      // Once a minute: a change the stream missed, and the next bucket item
      timer = setInterval(() => pull().catch(() => {}), 60_000);
      timer.unref?.();
    },
    stop() {
      abort.abort();
      clearInterval(timer);
    },
  };
}

export const demoListe = (now = Date.now()) => {
  const date = (days) => new Date(now + days * 86_400_000).toISOString().slice(0, 10);
  return {
    t: 'liste',
    v: 1,
    at: now,
    leute: [{ code: 'PAUL01', name: 'Paul', farbe: 'lila' }, { code: 'JANA01', name: 'Jana', farbe: 'pink' }],
    offen: 4,
    todos: [
      { text: 'Geschenk für Oma', due: date(0), who: 'JANA01' },
      { text: 'Zugtickets nach Wien buchen', due: date(3), who: 'PAUL01' },
      { text: 'Fahrrad zur Werkstatt', due: null, who: 'wir' },
      { text: 'Wäsche aufhängen', due: null, who: 'PAUL01' },
    ],
    bucket: [
      { text: 'Nordlichter in Norwegen sehen', stimmen: { PAUL01: 1, JANA01: 1 }, einig: true, unbedingt: true },
      { text: 'Zusammen einen Kochkurs machen', stimmen: { PAUL01: 1, JANA01: 2 }, einig: true, unbedingt: false },
      { text: 'Mit dem Nachtzug nach Wien', stimmen: { PAUL01: 2 }, einig: false, unbedingt: false },
    ],
  };
};

export default {
  id: 'todo',
  intervalMs: 60_000,
  isConfigured: configured,

  watch(ctx, emit) {
    if (!configured(ctx.config)) return () => {};
    const runner = createRunner(ctx, emit);
    runners.set(ctx.store, runner);
    runner.start().catch((error) => ctx.log.warn(`[todo] ${error.message}`));
    return () => {
      runner.stop();
      if (runners.get(ctx.store) === runner) runners.delete(ctx.store);
    };
  },

  async fetch(ctx) {
    const runner = runners.get(ctx.store);
    const liste = runner ? runner.liste : validateListe(await ctx.store.read(FILE, null));
    return toWidgetData(liste, ctx.now?.() ?? new Date(), ctx.config.timezone);
  },

  demo: (ctx) => {
    const mode = ctx?.config?.get?.('DASH_DEMO_TODO', '') ?? '';
    const liste = demoListe();
    // DASH_DEMO_TODO=erledigt shows the tile with every to-do done
    if (mode === 'erledigt') Object.assign(liste, { todos: [], offen: 0 });
    return toWidgetData(validateListe(liste), ctx?.now?.() ?? new Date(), ctx?.config?.timezone ?? 'Europe/Berlin');
  },
};
