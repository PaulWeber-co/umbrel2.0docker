// Front end of the dashboard: loads /api/state, builds a tile per layout
// entry, keeps every tile current through Server-Sent Events, runs the clock
// and switches scenes by time of day. The sliders button opens the control
// center (control-panel.js) over it. The kiosk on the XPS loads the page as
// /?kiosk=1; only there the screen goes dark when the control center says so.
import { bindDialog, createPanel } from './control-panel.js';
import { applyRects, normalRects } from './layout.js';
import { createScenes, GREETINGS, sceneAt } from './scene.js';
import * as display from './features/display.js';
import * as edit from './features/edit.js';
import * as music from './features/music.js';
import { applyGlass, DEFAULT_GLASS } from './glass.js';
import { $, $$, esc, icon } from './util.js';
import widgets from './widgets/index.js';

const stage = $('#stage');
const kiosk = new URLSearchParams(location.search).has('kiosk');
const state = {
  name: '',
  timezone: 'Europe/Berlin',
  demo: false,
  widgets: {},
  layout: { tiles: [], hidden: [] },
  control: null,
  access: null,
  glassLevel: DEFAULT_GLASS,
  scale: 1,
};
const scenes = createScenes(stage);

/* ---------- glass level: one setting for every browser and the kiosk ---------- */
let glassSaveTimer = null;

function applyGlassLevel(value) {
  state.glassLevel = applyGlass(stage, value);
  return state.glassLevel;
}

async function saveGlassLevel(value) {
  clearTimeout(glassSaveTimer);
  glassSaveTimer = null;
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ glassLevel: value }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error('Glas-Einstellung konnte nicht gespeichert werden:', error);
  }
}

applyGlassLevel(DEFAULT_GLASS);
// The slider in the control center: live while dragging, saved shortly after
function setGlass(value, { save }) {
  const normalized = applyGlassLevel(value);
  clearTimeout(glassSaveTimer);
  if (save) saveGlassLevel(normalized);
  else glassSaveTimer = setTimeout(() => saveGlassLevel(normalized), 180);
}

/* ---------- control center ---------- */
const controlListeners = [];
function deliverControl(snapshot) {
  state.control = snapshot;
  for (const listener of controlListeners) listener(snapshot);
  panel.update();
}
const panel = createPanel($('#control'), {
  getState: () => state,
  onControl: deliverControl,
  onAccess: (access) => {
    state.access = access;
    panel.update();
  },
  onLayout: (layout) => {
    state.layout = layout;
    buildTiles();
    relayout(true);
    panel.update();
  },
  onGlass: setGlass,
  onClose: () => dialog.close(),
  onArrange: () => {
    dialog.close();
    stage.dataset.edit = '1';
  },
});
const dialog = bindDialog({ toggle: $('#settings-toggle'), overlay: $('#control-overlay'), panel: $('#control'), onOpen: () => panel.update() });

/* ---------- scale the 1920×1080 stage to the window ---------- */
function fit() {
  const screen = $('#screen');
  state.scale = Math.min(screen.clientWidth / 1920, screen.clientHeight / 1080);
  document.documentElement.style.setProperty('--s', state.scale.toFixed(4));
}

/* ---------- tiles ---------- */
const tileEl = (id) => $(`#tiles .t[data-id="${CSS.escape(id)}"]`);

function buildTiles() {
  const host = $('#tiles');
  host.textContent = '';
  const ids = [...state.layout.tiles.map((t) => t.id), ...(state.layout.hidden ?? [])];
  for (const id of ids) {
    const el = document.createElement('article');
    el.className = 't';
    el.dataset.id = id;
    const name = widgets[id]?.label ?? id;
    el.innerHTML = `<div class="body"></div><button class="x" type="button" aria-label="${esc(name)} entfernen">${icon('x')}</button>`;
    host.append(el);
    renderTile(id);
  }
}

export function renderTile(id) {
  const el = tileEl(id);
  if (!el) return;
  const entry = state.widgets[id];
  const module = widgets[id];
  const body = el.querySelector('.body');
  try {
    body.innerHTML = module
      ? module.render(entry?.data ?? null, { compact: stage.dataset.music === '1', entry })
      : `<div class="lbl">${esc(id)}</div><div class="loading">kommt bald</div>`;
  } catch (error) {
    console.error(`Widget ${id}:`, error);
    body.innerHTML = `<div class="lbl">${esc(module?.label ?? id)}</div><div class="loading">Anzeige fehlgeschlagen</div>`;
  }
  el.classList.toggle('is-error', Boolean(entry?.error));
  // Sample data (widget not set up yet) gets a small "Beispiel" mark on its tile
  el.classList.toggle('is-demo', Boolean(entry?.demo));
}

// A feature such as music mode can move tiles elsewhere: it registers a
// provider that returns rects (Map id → [x, y, w, h] | null) or null for "normal".
let rectsProvider = () => null;
// The display feature can force a scene ("nacht" when the control center
// shows the night clock); null means "by time of day".
let sceneOverride = () => null;

export function relayout(animate = true) {
  const rects = rectsProvider(state.layout) ?? normalRects(state.layout);
  applyRects($$('#tiles .t'), rects, { animate, scale: state.scale });
}

/* ---------- features that are not tiles: music mode, edit mode, display state ----------
   Each feature module exports init(ctx) and is listed in FEATURES below. */
const entryListeners = new Map();
function deliver(entry) {
  state.widgets[entry.id] = entry;
  renderTile(entry.id);
  for (const listener of entryListeners.get(entry.id) ?? []) listener(entry);
  if (dialog.isOpen()) panel.update();
}
const featureContext = {
  stage,
  state,
  kiosk,
  scenes,
  relayout,
  renderTile,
  buildTiles: () => buildTiles(),
  runAction: (...args) => runAction(...args),
  // Called with every update of widget id (also ones without a tile, e.g. "music")
  onEntry(id, listener) {
    if (!entryListeners.has(id)) entryListeners.set(id, []);
    entryListeners.get(id).push(listener);
    if (state.widgets[id]) listener(state.widgets[id]);
  },
  setRectsProvider(provider) {
    rectsProvider = provider;
  },
  setSceneOverride(provider) {
    sceneOverride = provider;
  },
  // Called with every snapshot of the control center (server/control.js)
  onControl(listener) {
    controlListeners.push(listener);
    if (state.control) listener(state.control);
  },
};
const FEATURES = [music, edit, display];

/* ---------- widget actions ----------
   A widget module only writes markup: <button data-action="toggle"
   data-payload='{"id":"x"}'> or <form data-action="add"> (payload = the
   form's fields). The click goes to POST /api/widgets/<id>/actions/<name>; the
   widget's new data comes back over /api/events and re-renders the tile. */
export async function runAction(id, name, payload = {}) {
  const response = await fetch(`/api/widgets/${encodeURIComponent(id)}/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.result;
}

function onTileAction(event) {
  const isSubmit = event.type === 'submit';
  // In edit mode taps arrange tiles; only forms (e.g. a new to-do) still work.
  if (stage.dataset.edit === '1' && !isSubmit) return;
  const el = isSubmit ? event.target.closest('form[data-action]') : event.target.closest('[data-action]:not(form)');
  const tile = el?.closest('.t');
  if (!el || !tile) return;
  event.preventDefault();
  let payload = {};
  if (isSubmit) payload = Object.fromEntries(new FormData(el));
  else {
    try {
      payload = JSON.parse(el.dataset.payload || '{}');
    } catch {
      console.error('data-payload ist kein JSON:', el.dataset.payload);
    }
    // Answer the touch at once; the server's data confirms or corrects it.
    if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true'));
  }
  runAction(tile.dataset.id, el.dataset.action, payload)
    .then(() => isSubmit && el.reset())
    .catch((error) => {
      console.error(`Aktion ${el.dataset.action} von ${tile.dataset.id}:`, error);
      renderTile(tile.dataset.id);
    });
}
$('#tiles').addEventListener('click', onTileAction);
$('#tiles').addEventListener('submit', onTileAction);

/* ---------- clock, greeting, scene ---------- */
function tick() {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: state.timezone })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const time = `${parts.hour}:${parts.minute}`;
  $$('.js-time').forEach((el) => {
    if (el.textContent !== time) el.textContent = time;
  });
  const date = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: state.timezone }).format(now);
  $$('.js-date').forEach((el) => {
    if (el.textContent !== date) el.textContent = date;
  });
  scenes.set(sceneOverride() ?? sceneAt(Number(parts.hour) * 60 + Number(parts.minute), state.widgets.wetter?.data?.sun));
  const greeting = GREETINGS[scenes.scene] + (state.name ? `, ${state.name}` : '');
  if ($('#greet').textContent !== greeting) $('#greet').textContent = greeting;
}

/* ---------- live updates ---------- */
function connect() {
  const events = new EventSource('/api/events');
  let offlineTimer = null;
  events.addEventListener('open', () => {
    clearTimeout(offlineTimer);
    $('#chip-offline').classList.remove('on');
  });
  events.addEventListener('error', () => {
    // EventSource reconnects on its own; only say so if it takes a while.
    clearTimeout(offlineTimer);
    offlineTimer = setTimeout(() => $('#chip-offline').classList.add('on'), 30_000);
  });
  events.addEventListener('widget', (event) => deliver(JSON.parse(event.data)));
  events.addEventListener('settings', (event) => {
    const value = Number(JSON.parse(event.data).glassLevel);
    if (Number.isFinite(value) && document.activeElement?.dataset?.glass === undefined) applyGlassLevel(value);
    panel.update();
  });
  events.addEventListener('control', (event) => deliverControl(JSON.parse(event.data)));
  events.addEventListener('layout', (event) => {
    // Our own edits come back here too; only rebuild for changes made elsewhere.
    if (event.data === JSON.stringify(state.layout)) return;
    state.layout = JSON.parse(event.data);
    buildTiles();
    relayout(true);
    panel.update();
  });
}

async function boot() {
  fit();
  addEventListener('resize', () => {
    fit();
    relayout(false);
  });
  const response = await fetch('/api/state');
  const data = await response.json();
  Object.assign(state, {
    name: data.name,
    timezone: data.timezone,
    demo: data.demo,
    widgets: data.widgets,
    layout: data.layout,
    control: data.control,
    access: data.access,
  });
  applyGlassLevel(data.settings?.glassLevel ?? DEFAULT_GLASS);
  buildTiles();
  relayout(false);
  for (const feature of FEATURES) feature.init(featureContext);
  if (location.hash === '#steuerung') dialog.open();
  tick();
  setInterval(tick, 1000);
  connect();
}

boot().catch((error) => {
  console.error(error);
  $('#chip-offline').classList.add('on');
  setTimeout(() => location.reload(), 30_000);
});
