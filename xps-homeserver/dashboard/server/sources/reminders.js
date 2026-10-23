// A list from Apple's Reminders app (say "Einkauf") on the wall's to-do tile.
//
// Reminders has no interface a server can reach, but the Shortcuts app on
// the iPhone can read and change it. So a shortcut does the syncing: it
// sends the open reminders of the list to the dashboard and gets back what
// happened on the wall meanwhile, which it then applies in Reminders:
//
//   POST /api/widgets/todo/actions/sync   { "text": "Milch\nBrot" }
//     → { ok, result: { done: ["Milch"], add: ["Kaffee"] } }
//
// "done" was ticked off on the wall, "add" typed in there. Both stay pending
// until a later sync confirms them (the item gone from, or showing up in, the
// list the shortcut sends), so a shortcut that fails halfway simply gets the
// same answer next time. Pending changes older than a week are dropped.
// Items are matched by title, as Shortcuts offers no stable identifier.
//
// Pure functions; widgets/todo.js keeps the state in the data directory.

export const FILE = 'reminders.json';
export const MAX_TITLE = 160;
const MAX_ITEMS = 200;
const PENDING_MS = 7 * 24 * 60 * 60_000;

export const keyOf = (title) => String(title ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export const emptyState = () => ({ items: [], syncedAt: null, done: [], add: [] });

// Whatever the shortcut sends: { text: "a\nb" } (Combine Text with new
// lines), { items: ["a", "b"] } or { items: [{ title: "a" }] }
export function cleanTitles(payload) {
  const raw = Array.isArray(payload?.items)
    ? payload.items.map((item) => (typeof item === 'object' && item ? item.title ?? item.name ?? '' : item))
    : String(payload?.text ?? '').split(/\r\n?|\n/);
  const seen = new Set();
  const titles = [];
  for (const value of raw) {
    const title = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    const key = keyOf(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= MAX_ITEMS) break;
  }
  return titles;
}

function normalise(state) {
  const list = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry?.title === 'string') : []);
  return {
    items: Array.isArray(state?.items) ? state.items.filter((title) => typeof title === 'string') : [],
    syncedAt: Number.isFinite(state?.syncedAt) ? state.syncedAt : null,
    done: list(state?.done),
    add: list(state?.add),
  };
}

// The shortcut's list arrives → the new state and the answer for it
export function applySync(state, titles, now = Date.now()) {
  const current = normalise(state);
  const present = new Set(titles.map(keyOf));
  const fresh = (entry) => now - entry.at < PENDING_MS;
  // Ticked on the wall and gone from Reminders: done. Typed on the wall and
  // now in Reminders: done too.
  const done = current.done.filter((entry) => present.has(keyOf(entry.title)) && fresh(entry));
  const add = current.add.filter((entry) => !present.has(keyOf(entry.title)) && fresh(entry));
  const next = { items: titles, syncedAt: now, done, add };
  return { state: next, reply: { done: done.map((entry) => entry.title), add: add.map((entry) => entry.title) } };
}

// Ticked off on the wall
export function complete(state, key, now = Date.now()) {
  const current = normalise(state);
  const wanted = keyOf(key);
  // Typed here and not yet in Reminders: simply forget it
  const add = current.add.filter((entry) => keyOf(entry.title) !== wanted);
  if (add.length !== current.add.length) return { ...current, add };
  const title = current.items.find((item) => keyOf(item) === wanted);
  if (!title || current.done.some((entry) => keyOf(entry.title) === wanted)) return current;
  return { ...current, done: [...current.done, { title, at: now }] };
}

// Typed in on the wall
export function addItem(state, title, now = Date.now()) {
  const current = normalise(state);
  const clean = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  const key = keyOf(clean);
  if (!key) return current;
  // Ticked off a moment ago and typed again: it stays
  const done = current.done.filter((entry) => keyOf(entry.title) !== key);
  if (current.items.some((item) => keyOf(item) === key) || current.add.some((entry) => keyOf(entry.title) === key)) return { ...current, done };
  return { ...current, done, add: [...current.add, { title: clean, at: now }] };
}

// → the tile's data: the list as Reminders has it, with the wall's changes
export function toWidgetData(state, listName) {
  const current = normalise(state);
  const ticked = new Set(current.done.map((entry) => keyOf(entry.title)));
  const items = [
    ...current.items.filter((title) => !ticked.has(keyOf(title))).map((title) => ({ uid: keyOf(title), summary: title, due: null })),
    ...current.add.map((entry) => ({ uid: keyOf(entry.title), summary: entry.title, due: null, pending: true })),
  ];
  return { source: 'apple', title: listName || 'Erinnerungen', syncedAt: current.syncedAt, items };
}
