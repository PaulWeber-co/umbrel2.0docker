// Front end of the dashboard: loads /api/state, builds a tile per layout
// entry, keeps every tile current through Server-Sent Events, runs the clock
// and switches scenes by time of day.
import { applyRects, normalRects } from './layout.js';
import { createScenes, GREETINGS, sceneAt } from './scene.js';
import { $, $$, esc, icon } from './util.js';
import widgets from './widgets/index.js';

const stage = $('#stage');
const state = { name: '', timezone: 'Europe/Berlin', widgets: {}, layout: { tiles: [], hidden: [] }, scale: 1 };
const scenes = createScenes(stage);

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
  $('#chip-demo').classList.toggle('on', Object.values(state.widgets).some((w) => w.demo));
}

export function relayout(animate = true) {
  applyRects($$('#tiles .t'), normalRects(state.layout), { animate, scale: state.scale });
}

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
  scenes.set(sceneAt(Number(parts.hour) * 60 + Number(parts.minute), state.widgets.wetter?.data?.sun));
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
  events.addEventListener('widget', (event) => {
    const entry = JSON.parse(event.data);
    state.widgets[entry.id] = entry;
    renderTile(entry.id);
  });
  events.addEventListener('layout', (event) => {
    state.layout = JSON.parse(event.data);
    buildTiles();
    relayout(true);
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
  Object.assign(state, { name: data.name, timezone: data.timezone, widgets: data.widgets, layout: data.layout });
  buildTiles();
  relayout(false);
  tick();
  setInterval(tick, 1000);
  connect();
}

boot().catch((error) => {
  console.error(error);
  $('#chip-offline').classList.add('on');
  setTimeout(() => location.reload(), 30_000);
});
