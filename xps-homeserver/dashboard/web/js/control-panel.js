// The control center ("Steuerung") as one panel. On the wall display it opens
// over the dashboard (the sliders button, app.js); on a phone or a Mac it is
// the page /steuerung (steuerung.js). Both hosts keep the state current from
// /api/events and call update(); the panel only writes markup and sends
// changes:
//
//   PUT  /api/control            mode, schedule, rules, features (only the changed field)
//   POST /api/control/override   quick actions ("Aus · 1 Std.") and "Zurück zur Automatik"
//   PUT  /api/layout             show or hide a tile
//   POST /api/unlock             the PIN, when DASH_PIN is set and this is another device
//
// Every answer comes back as a full snapshot through onControl(), so the panel
// shows the server's view right away and never guesses.
//
// getState() → { control, access, glassLevel, layout, widgets, demo }
import { DEFAULT_SIZES } from './features/edit.js';
import { addTile, removeTile } from './grid.js';
import { esc, icon } from './util.js';
import widgets from './widgets/index.js';

export const DISPLAY_NAMES = { on: 'An', night: 'Nachtuhr', sleep: 'Schwarz', off: 'Aus' };
const MODES = [
  ['auto', 'Automatisch', 'Zeitplan und Regeln'],
  ['on', 'Immer an', 'Dashboard rund um die Uhr'],
  ['off', 'Aus', 'nur Server, Display aus'],
];
const OUTSIDE = [
  ['night', 'Nachtuhr'],
  ['sleep', 'Schwarz'],
  ['off', 'Aus'],
];
const AWAY = [
  ['sleep', 'schwarz'],
  ['off', 'aus'],
];
const TOUCH = [0, 1, 2, 5, 10, 15, 30];
const QUICK = [
  { label: 'An', note: '1 Std.', body: { state: 'on', minutes: 60 } },
  { label: 'Schwarz', note: '1 Std.', body: { state: 'sleep', minutes: 60 } },
  { label: 'Aus', note: '1 Std.', body: { state: 'off', minutes: 60 } },
  { label: 'Aus', note: 'bis morgen', body: { state: 'off', until: 'morning' } },
];
const UNIT_STATES = { active: 'läuft', activating: 'startet', deactivating: 'stoppt', inactive: 'aus', failed: 'Fehler' };

/* ---------- formatting (pure, used by the tests) ---------- */

// An instant as "22:30" (today), "morgen 06:00" or "Sa 07:00", in the dashboard's time zone.
export function formatAt(ms, timeZone, nowMs = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const day = (value) => new Intl.DateTimeFormat('de-DE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const time = new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  if (day(ms) === day(nowMs)) return time;
  if (day(ms) === day(nowMs + 86_400_000)) return `morgen ${time}`;
  const weekday = new Intl.DateTimeFormat('de-DE', { timeZone, weekday: 'short' }).format(ms).replace('.', '');
  return `${weekday} ${time}`;
}

// "noch 42 Min." / "noch 2 Std." for what ends soon, else "bis 22:30"
export function formatUntil(ms, timeZone, nowMs = Date.now()) {
  const minutes = Math.ceil((ms - nowMs) / 60_000);
  if (minutes <= 0) return '';
  if (minutes < 60) return `noch ${minutes} Min.`;
  if (minutes < 180 && minutes % 60 === 0) return `noch ${minutes / 60} Std.`;
  return `bis ${formatAt(ms, timeZone, nowMs)}`;
}

// One line under the big state: why, and until when
export function describe(snapshot, nowMs = Date.now()) {
  const { effective, timezone } = snapshot;
  if (!effective) return { title: '–', reason: '', next: '' };
  const until = effective.until ? formatUntil(effective.until, timezone, nowMs) : '';
  let next = '';
  if (effective.next && ['schedule', 'dark'].includes(effective.source)) {
    next = `Danach ${DISPLAY_NAMES[effective.next.display]} ab ${formatAt(effective.next.at, timezone, nowMs)}`;
  }
  return { title: DISPLAY_NAMES[effective.display] ?? effective.display, reason: [effective.reason, until].filter(Boolean).join(' · '), next };
}

// "rules.darkRoom", true → { rules: { darkRoom: true } }
export function nested(path, value) {
  return path
    .split('.')
    .reverse()
    .reduce((inner, key) => ({ [key]: inner }), value);
}

const valueAt = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);

/* ---------- the panel ---------- */

export function createPanel(root, { getState, onControl, onAccess = () => {}, onLayout = () => {}, onGlass = () => {}, onClose = null, onArrange = null }) {
  let editing = null; // an input the user is busy with: no re-render under their finger
  let pending = false;
  let message = '';
  let messageTimer = 0;

  async function send(method, path, body) {
    const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      onAccess({ ...(getState().access ?? {}), locked: true });
      throw new Error(path === '/api/unlock' ? result.error ?? 'Falsche PIN' : 'Gesperrt: bitte zuerst die PIN eingeben');
    }
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    return result;
  }

  async function change(body) {
    onControl(await send('PUT', '/api/control', body));
  }

  function flash(text) {
    message = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message = '';
      update();
    }, 5000);
    update();
  }

  const attempt = (work) =>
    work().catch((error) => {
      console.error('Steuerung:', error);
      flash(error.message);
    });

  /* ---------- markup ---------- */

  const segmented = (name, options, current, { disabled = false } = {}) =>
    `<div class="cp-seg" role="radiogroup">${options
      .map(
        ([value, label, hint]) =>
          `<button type="button" role="radio" aria-checked="${value === current}" data-act="${name}" data-value="${esc(value)}" data-key="${name}-${esc(value)}"${disabled ? ' disabled' : ''}>` +
          `<span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</button>`,
      )
      .join('')}</div>`;

  const toggle = (path, on, label, hint = '', { disabled = false } = {}) =>
    `<button type="button" class="cp-row cp-toggle" role="switch" aria-checked="${Boolean(on)}" data-act="toggle" data-path="${path}" data-key="${path}"${disabled ? ' disabled' : ''}>` +
    `<span class="cp-text"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</span><i class="cp-knob" aria-hidden="true"></i></button>`;

  // Hour and minute as two selects: 24 hours on every device and in every
  // browser language, and a thumb-friendly wheel on phones
  const pad = (n) => String(n).padStart(2, '0');
  const timeInput = (path, value, label) => {
    const [hour, minute] = String(value).split(':').map(Number);
    const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), minute])].sort((a, b) => a - b);
    const options = (list, current) => list.map((n) => `<option value="${pad(n)}"${n === current ? ' selected' : ''}>${pad(n)}</option>`).join('');
    return (
      `<span class="cp-time" data-time="${path}"><span>${esc(label)}</span>` +
      `<select data-part="h" data-key="${path}.h" aria-label="${esc(label)}: Stunde">${options(Array.from({ length: 24 }, (_, i) => i), hour)}</select>` +
      `<b>:</b><select data-part="m" data-key="${path}.m" aria-label="${esc(label)}: Minute">${options(minutes, minute)}</select></span>`
    );
  };

  const unitState = (value) => (value ? UNIT_STATES[value] ?? value : '–');

  function header(state) {
    const snapshot = state.control;
    const { title, reason, next } = describe(snapshot);
    const display = snapshot?.effective?.display ?? 'on';
    const overridden = snapshot?.effective?.source === 'override';
    return `
      <header class="cp-head">
        <div class="cp-head-text">
          <h2 id="control-title">Steuerung</h2>
          <p>Wandbildschirm, Zeitplan und Funktionen</p>
        </div>
        ${onClose ? `<button type="button" class="cp-close" data-act="close" aria-label="Steuerung schließen">${icon('x')}</button>` : ''}
      </header>
      <div class="cp-now" data-display="${esc(display)}">
        <span class="cp-dot" aria-hidden="true"></span>
        <div>
          <div class="cp-now-title">Bildschirm: ${esc(title)}</div>
          <div class="cp-now-reason">${esc(reason)}</div>
          ${next ? `<div class="cp-now-next">${esc(next)}</div>` : ''}
        </div>
        ${overridden ? `<button type="button" class="cp-pill" data-act="clear" data-key="clear">Zurück zur Automatik</button>` : ''}
      </div>
      ${message ? `<div class="cp-msg" role="status">${esc(message)}</div>` : ''}`;
  }

  function lock(state) {
    if (!state.access?.locked) return '';
    return `
      <form class="cp-card cp-lock" data-form="unlock">
        <h3>Gesperrt</h3>
        <p>Von diesem Gerät aus braucht jede Änderung die PIN (DASH_PIN). Ansehen geht auch ohne.</p>
        <div class="cp-lock-row">
          <input type="password" name="pin" inputmode="numeric" autocomplete="current-password" placeholder="PIN" aria-label="PIN" data-key="pin" required>
          <button type="submit" class="cp-primary">Entsperren</button>
        </div>
      </form>`;
  }

  function screen(settings) {
    return `
      <section class="cp-card">
        <h3>Bildschirm</h3>
        ${segmented('mode', MODES, settings.mode)}
        <div class="cp-quick" aria-label="Für eine Weile">
          ${QUICK.map((quick, i) => `<button type="button" data-act="quick" data-index="${i}" data-key="quick-${i}"><span>${esc(quick.label)}</span><small>${esc(quick.note)}</small></button>`).join('')}
        </div>
      </section>`;
  }

  function schedule(settings, snapshot) {
    const auto = settings.mode === 'auto';
    return `
      <section class="cp-card${auto ? '' : ' cp-muted'}">
        <h3>Zeitplan <small>${auto ? 'gilt im Modus Automatisch' : 'gilt nur im Modus Automatisch'}</small></h3>
        <div class="cp-days">
          <div class="cp-day"><b>Mo – Fr</b>${timeInput('schedule.weekdays.on', settings.schedule.weekdays.on, 'an')}${timeInput('schedule.weekdays.off', settings.schedule.weekdays.off, 'aus')}</div>
          <div class="cp-day"><b>Sa, So</b>${timeInput('schedule.weekend.on', settings.schedule.weekend.on, 'an')}${timeInput('schedule.weekend.off', settings.schedule.weekend.off, 'aus')}</div>
        </div>
        <div class="cp-label">Außerhalb der Zeiten</div>
        ${segmented('outside', OUTSIDE, settings.outside)}
        ${snapshot?.effective?.next ? `<p class="cp-note">Nächster Wechsel: ${esc(DISPLAY_NAMES[snapshot.effective.next.display])} ab ${esc(formatAt(snapshot.effective.next.at, snapshot.timezone))}</p>` : ''}
      </section>`;
  }

  function rules(settings, snapshot) {
    const { rules: r } = settings;
    const inputs = snapshot?.inputs ?? {};
    const presence = !r.presenceEntity
      ? 'Aus. Mit einer Home-Assistant-Entität (person.paul, group.familie, zone.home) geht der Bildschirm aus, wenn niemand da ist.'
      : inputs.presenceError
        ? `Kein Wert: ${inputs.presenceError}`
        : inputs.present === true
          ? 'Gerade: jemand zu Hause'
          : inputs.present === false
            ? 'Gerade: niemand zu Hause'
            : 'Noch kein Wert';
    return `
      <section class="cp-card">
        <h3>Automatik</h3>
        ${toggle('rules.darkRoom', r.darkRoom, 'Dunkler Raum → Nachtuhr', 'misst die Webcam, ohne Bilder zu speichern')}
        ${toggle('rules.musicWakes', r.musicWakes, 'Musik weckt den Bildschirm', 'AirPlay oder Spotify zeigt Cover und Titel, auch nachts', { disabled: !settings.features.musicMode })}
        ${toggle('rules.batterySaver', r.batterySaver, 'Bei Akkubetrieb aus', 'Stromausfall: Umbrel läuft länger')}
        <label class="cp-row">
          <span class="cp-text"><span>Antippen weckt</span><small>dunklen Bildschirm kurz einschalten</small></span>
          <select data-path="rules.touchWake" data-key="rules.touchWake" data-number>
            ${TOUCH.map((m) => `<option value="${m}"${m === r.touchWake ? ' selected' : ''}>${m ? `${m} Min.` : 'nie'}</option>`).join('')}
          </select>
        </label>
        <div class="cp-presence">
          <label class="cp-text" for="cp-presence"><span>Niemand zu Hause</span><small>${esc(presence)}</small></label>
          <div class="cp-presence-row">
            <input id="cp-presence" type="text" placeholder="person.paul" value="${esc(r.presenceEntity)}" data-path="rules.presenceEntity" data-key="rules.presenceEntity" spellcheck="false" autocapitalize="off">
            <select data-path="rules.presenceAway" data-key="rules.presenceAway" aria-label="Dann">
              ${AWAY.map(([value, label]) => `<option value="${value}"${value === r.presenceAway ? ' selected' : ''}>dann ${label}</option>`).join('')}
            </select>
          </div>
        </div>
      </section>`;
  }

  function features(settings, state) {
    const { features: f } = settings;
    const status = state.control?.status;
    const current = Number.isFinite(status?.backlightPercent) ? ` · gerade ${status.backlightPercent} %` : '';
    return `
      <section class="cp-card">
        <h3>Funktionen</h3>
        ${toggle('features.autoBrightness', f.autoBrightness, 'Automatische Helligkeit', `über die Webcam${current}`)}
        <label class="cp-row cp-range${f.autoBrightness ? ' cp-muted' : ''}">
          <span class="cp-text"><span>Helligkeit</span><small data-live="brightness">${f.brightness} %${f.autoBrightness ? ' · nur ohne Automatik' : ''}</small></span>
          <input type="range" min="5" max="100" step="5" value="${f.brightness}" data-path="features.brightness" data-key="features.brightness" data-number${f.autoBrightness ? ' disabled' : ''} aria-label="Helligkeit in Prozent">
        </label>
        ${toggle('features.airplay', f.airplay, 'Lautsprecher', 'AirPlay und Spotify Connect, „XPS Lautsprecher“ an der Kopfhörerbuchse')}
        ${toggle('features.musicMode', f.musicMode, 'Musikansicht', 'Cover, Titel und Fortschritt unter der Uhr')}
        ${toggle('features.videos', f.videos, 'Hintergrundvideos', 'aus: ruhige Farbverläufe, spart Strom')}
        <label class="cp-row cp-range">
          <span class="cp-text"><span>Glas-Effekt</span><small data-live="glass">${state.glassLevel ?? 55} · klar bis milchig</small></span>
          <input type="range" min="0" max="100" step="1" value="${state.glassLevel ?? 55}" data-glass data-key="glass" aria-label="Glas-Effekt von klar bis milchig">
        </label>
      </section>`;
  }

  function tiles(state) {
    const layout = state.layout ?? { tiles: [], hidden: [] };
    const visible = new Set(layout.tiles.map((tile) => tile.id));
    const ids = [...layout.tiles.map((tile) => tile.id), ...(layout.hidden ?? []).filter((id) => !visible.has(id))];
    const rows = ids
      .map((id) => {
        const entry = state.widgets?.[id];
        const badge = entry?.error
          ? `<em class="cp-badge cp-bad" title="${esc(entry.error)}">Fehler</em>`
          : entry?.demo
            ? `<em class="cp-badge" title="Einstellung in dashboard.env fehlt">Beispiel</em>`
            : entry
              ? '<em class="cp-badge cp-good">Live</em>'
              : '';
        return (
          `<button type="button" class="cp-row cp-toggle" role="switch" aria-checked="${visible.has(id)}" data-act="tile" data-id="${esc(id)}" data-key="tile-${esc(id)}">` +
          `<span class="cp-text"><span>${esc(widgets[id]?.label ?? id)} ${badge}</span></span><i class="cp-knob" aria-hidden="true"></i></button>`
        );
      })
      .join('');
    return `
      <section class="cp-card">
        <h3>Kacheln <small>„Beispiel“: Einstellung fehlt noch</small></h3>
        ${rows}
        ${onArrange ? '<button type="button" class="cp-wide" data-act="arrange" data-key="arrange">Kacheln anordnen …</button>' : '<p class="cp-note">Anordnen: lange auf eine Kachel des Dashboards drücken.</p>'}
      </section>`;
  }

  function system(state) {
    const snapshot = state.control ?? {};
    const status = snapshot.status;
    const inputs = snapshot.inputs ?? {};
    const host = snapshot.host ?? {};
    const ambient = state.widgets?.ambient?.data;
    const rows = [
      ['Kiosk-Browser', status ? unitState(status.kiosk) : '–'],
      ['Lautsprecher', status ? unitState(status.airplay) : '–'],
      ['Webcam', !host.camera ? 'aus' : ambient?.available ? `misst · Raum ${ambient.ambientPercent} %` : 'an'],
      ['Helligkeit', Number.isFinite(status?.backlightPercent) ? `${status.backlightPercent} %` : '–'],
      ['Strom', inputs.onBattery === true ? 'Akku' : inputs.onBattery === false ? 'Netzteil' : '–'],
      ['Musik', inputs.musicActive ? 'läuft' : 'still'],
    ];
    return `
      <section class="cp-card">
        <h3>System</h3>
        <dl class="cp-facts">${rows.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
        ${status ? '' : `<p class="cp-note">${state.demo ? 'Beispielmodus: ' : ''}Kein Kontakt zu xps-control; Bildschirm, Kiosk und Helligkeit schaltet nur der Dienst auf dem XPS.</p>`}
      </section>`;
  }

  /* ---------- render ---------- */

  function update() {
    if (editing) {
      pending = true;
      return;
    }
    pending = false;
    const state = getState();
    const settings = state.control?.settings;
    const focusKey = root.contains(document.activeElement) ? document.activeElement.dataset?.key : null;
    const scroller = root.querySelector('.cp-scroll');
    const scroll = scroller?.scrollTop ?? 0;
    root.innerHTML = `
      ${header(state)}
      <div class="cp-scroll">
        ${lock(state)}
        ${settings ? screen(settings) + schedule(settings, state.control) + rules(settings, state.control) + features(settings, state) : '<p class="cp-note">Die Steuerung lädt …</p>'}
        ${tiles(state)}
        ${system(state)}
      </div>`;
    const next = root.querySelector('.cp-scroll');
    if (next) next.scrollTop = scroll;
    if (focusKey) root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  /* ---------- events ---------- */

  function finishEditing() {
    editing = null;
    if (pending) update();
  }

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button || button.disabled) return;
    const state = getState();
    const settings = state.control?.settings;
    const act = button.dataset.act;
    if (act === 'close') return onClose?.();
    if (act === 'arrange') return onArrange?.();
    if (act === 'mode' || act === 'outside') return attempt(() => change({ [act]: button.dataset.value }));
    if (act === 'quick') return attempt(async () => onControl(await send('POST', '/api/control/override', QUICK[Number(button.dataset.index)].body)));
    if (act === 'clear') return attempt(async () => onControl(await send('POST', '/api/control/override', { clear: true })));
    if (act === 'toggle' && settings) {
      const path = button.dataset.path;
      return attempt(() => change(nested(path, !valueAt(settings, path))));
    }
    if (act === 'tile') return attempt(() => toggleTile(button.dataset.id));
  });

  async function toggleTile(id) {
    const layout = getState().layout;
    let next;
    if (layout.tiles.some((tile) => tile.id === id)) next = removeTile(layout, id);
    else {
      const { w, h } = DEFAULT_SIZES[id] ?? { w: 1, h: 1 };
      next = addTile(layout, id, w, h) ?? addTile(layout, id, 1, 1);
      if (!next) throw new Error('Kein Platz frei: erst eine andere Kachel ausblenden');
    }
    const response = await fetch('/api/layout', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) onAccess({ ...(getState().access ?? {}), locked: true });
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    onLayout(result);
  }

  root.addEventListener('focusin', (event) => {
    if (event.target.matches('input[type="text"], input[type="password"]')) editing = event.target;
  });
  root.addEventListener('focusout', (event) => {
    if (event.target === editing) setTimeout(finishEditing, 0);
  });
  root.addEventListener('pointerdown', (event) => {
    if (event.target.matches('input[type="range"]')) editing = event.target;
  });

  root.addEventListener('input', (event) => {
    const input = event.target;
    if (input.type !== 'range') return;
    editing = input;
    if (input.dataset.glass !== undefined) {
      onGlass(Number(input.value), { save: false });
      const live = root.querySelector('[data-live="glass"]');
      if (live) live.textContent = `${input.value} · klar bis milchig`;
    } else {
      const live = root.querySelector('[data-live="brightness"]');
      if (live) live.textContent = `${input.value} %`;
    }
  });

  root.addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset.glass !== undefined) {
      onGlass(Number(input.value), { save: true });
      finishEditing();
      return;
    }
    const time = input.closest('[data-time]');
    if (time) {
      const [hour, minute] = ['h', 'm'].map((part) => time.querySelector(`[data-part="${part}"]`).value);
      attempt(() => change(nested(time.dataset.time, `${hour}:${minute}`)));
      return;
    }
    const path = input.dataset.path;
    if (!path) return;
    const value = input.dataset.number !== undefined ? Number(input.value) : input.value;
    attempt(() => change(nested(path, value))).finally(() => {
      if (input.type === 'range' || input.tagName === 'SELECT') finishEditing();
    });
  });

  root.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form="unlock"]');
    if (!form) return;
    event.preventDefault();
    const pin = new FormData(form).get('pin');
    editing = null;
    attempt(async () => {
      onAccess(await send('POST', '/api/unlock', { pin }));
      flash('Entsperrt');
    });
  });

  // The relative times ("noch 12 Min.") age: refresh them once a minute
  setInterval(() => root.isConnected && !root.closest('[hidden]') && update(), 60_000);

  return { update };
}

/* ---------- the overlay on the dashboard ---------- */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Opens and closes the panel over the dashboard like a dialog: the toggle
// button, Escape, a click beside the panel and the × close it; Tab stays
// inside while it is open; focus returns to the toggle afterwards.
export function bindDialog({ toggle, overlay, panel, keyboard = document, onOpen = () => {} }) {
  const isOpen = () => !overlay.hidden;
  const set = (open) => {
    overlay.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Steuerung schließen' : 'Steuerung öffnen');
    if (open) {
      onOpen();
      panel.querySelectorAll(FOCUSABLE)[0]?.focus();
    } else toggle.focus();
  };
  overlay.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Steuerung öffnen');
  toggle.addEventListener('click', () => set(!isOpen()));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) set(false);
  });
  keyboard.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') return set(false);
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && keyboard.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && keyboard.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  return { open: () => set(true), close: () => set(false), isOpen };
}
