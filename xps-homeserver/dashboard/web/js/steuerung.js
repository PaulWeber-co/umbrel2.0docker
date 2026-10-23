// The page /steuerung: the control center without the dashboard behind it,
// for a phone or a Mac. Same panel as on the wall (control-panel.js); this
// file only loads the state and keeps it current through /api/events.
import { createPanel } from './control-panel.js';

const state = { widgets: {}, layout: { tiles: [], hidden: [] }, control: null, access: null, glassLevel: 55, demo: false };
const panel = createPanel(document.getElementById('control'), {
  getState: () => state,
  onControl: (snapshot) => {
    state.control = snapshot;
    panel.update();
  },
  onAccess: (access) => {
    state.access = access;
    panel.update();
  },
  onLayout: (layout) => {
    state.layout = layout;
    panel.update();
  },
  onGlass: (value, { save }) => {
    state.glassLevel = value;
    if (!save) return;
    fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ glassLevel: value }) })
      .then((response) => {
        if (response.status === 401) panel.update();
      })
      .catch((error) => console.error('Glas-Einstellung:', error));
  },
});

function connect() {
  const events = new EventSource('/api/events');
  events.addEventListener('control', (event) => {
    state.control = JSON.parse(event.data);
    panel.update();
  });
  events.addEventListener('widget', (event) => {
    const entry = JSON.parse(event.data);
    state.widgets[entry.id] = entry;
  });
  events.addEventListener('layout', (event) => {
    state.layout = JSON.parse(event.data);
    panel.update();
  });
  events.addEventListener('settings', (event) => {
    const value = Number(JSON.parse(event.data).glassLevel);
    if (Number.isFinite(value) && document.activeElement?.dataset?.glass === undefined) state.glassLevel = value;
  });
}

async function boot() {
  const data = await (await fetch('/api/state')).json();
  Object.assign(state, {
    widgets: data.widgets,
    layout: data.layout,
    control: data.control,
    access: data.access,
    glassLevel: data.settings?.glassLevel ?? 55,
    demo: data.demo,
  });
  panel.update();
  connect();
}

boot().catch((error) => {
  console.error(error);
  document.getElementById('control').innerHTML = '<p class="cp-note" style="padding: 2em">Keine Verbindung zum Dashboard. Läuft xps-dashboard?</p>';
  setTimeout(() => location.reload(), 15_000);
});
