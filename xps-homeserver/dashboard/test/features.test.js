import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { toWidgetData } from '../server/widgets/ambient.js';

test('the control center opens over the dashboard and replaces the glass dialog', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

  assert.match(html, /id="settings-toggle"[^>]*aria-controls="control"/);
  assert.match(html, /id="control-overlay"[^>]*hidden/);
  assert.match(html, /id="control"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.doesNotMatch(html, /glass-settings|fonts\.googleapis/);
  const page = readFileSync(new URL('../web/steuerung.html', import.meta.url), 'utf8');
  assert.match(page, /src="\/js\/steuerung\.js"/);
});

test('glass slider persists through shared dashboard settings', () => {
  const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');

  assert.match(app, /fetch\('\/api\/settings'/);
  assert.match(app, /addEventListener\('settings'/);
  assert.doesNotMatch(app, /saveGlass\s*\(|glassStorage|localStorage/);
});

test('the control dialog traps focus and closes with Escape, outside click, or the toggle', async () => {
  const { bindDialog } = await import(new URL('../web/js/control-panel.js', import.meta.url).href);
  const focusState = { activeElement: null };
  const fakeTarget = () => {
    const listeners = new Map();
    const attributes = new Map();
    return {
      attributes,
      focused: false,
      addEventListener: (type, listener) => listeners.set(type, listener),
      fire(type, event = {}) { listeners.get(type)?.(event); },
      focus() { this.focused = true; focusState.activeElement = this; },
      setAttribute: (name, value) => attributes.set(name, value),
    };
  };
  const toggle = fakeTarget();
  const first = fakeTarget();
  const last = fakeTarget();
  const keyboard = fakeTarget();
  Object.defineProperty(keyboard, 'activeElement', { get: () => focusState.activeElement });
  const overlay = fakeTarget();
  overlay.hidden = false;
  const panel = { querySelectorAll: () => [first, last] };
  let opened = 0;

  const dialog = bindDialog({ toggle, overlay, panel, keyboard, onOpen: () => opened++ });
  assert.equal(overlay.hidden, true);
  assert.equal(toggle.attributes.get('aria-expanded'), 'false');
  toggle.fire('click');
  assert.equal(overlay.hidden, false);
  assert.equal(opened, 1, 'the panel renders fresh when it opens');
  assert.equal(toggle.attributes.get('aria-expanded'), 'true');
  assert.equal(first.focused, true);
  last.focus();
  let prevented = false;
  keyboard.fire('keydown', { key: 'Tab', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(focusState.activeElement, first);
  keyboard.fire('keydown', { key: 'Tab', shiftKey: true, preventDefault: () => {} });
  assert.equal(focusState.activeElement, last);
  keyboard.fire('keydown', { key: 'Escape' });
  assert.equal(overlay.hidden, true);
  assert.equal(toggle.focused, true);
  toggle.fire('click');
  overlay.fire('click', { target: overlay });
  assert.equal(overlay.hidden, true);
  dialog.open();
  assert.equal(dialog.isOpen(), true);
  toggle.fire('click');
  assert.equal(overlay.hidden, true);
});

test('control panel texts: times in the dashboard zone, reasons and nested changes', async () => {
  const { describe, formatAt, formatUntil, nested } = await import(new URL('../web/js/control-panel.js', import.meta.url).href);
  const tz = 'Europe/Berlin';
  const now = Date.parse('2026-10-21T12:00:00+02:00');
  assert.equal(formatAt(Date.parse('2026-10-21T22:30:00+02:00'), tz, now), '22:30');
  assert.equal(formatAt(Date.parse('2026-10-22T06:00:00+02:00'), tz, now), 'morgen 06:00');
  assert.equal(formatAt(Date.parse('2026-10-24T07:00:00+02:00'), tz, now), 'Sa 07:00');
  assert.equal(formatUntil(now + 42 * 60_000, tz, now), 'noch 42 Min.');
  assert.equal(formatUntil(now + 120 * 60_000, tz, now), 'noch 2 Std.');
  assert.equal(formatUntil(Date.parse('2026-10-21T22:30:00+02:00'), tz, now), 'bis 22:30');
  assert.deepEqual(nested('rules.darkRoom', false), { rules: { darkRoom: false } });

  const snapshot = {
    timezone: tz,
    effective: { display: 'on', source: 'schedule', reason: 'Zeitplan', until: Date.parse('2026-10-21T22:30:00+02:00'), next: { display: 'night', at: Date.parse('2026-10-21T22:30:00+02:00') } },
  };
  assert.deepEqual(describe(snapshot, now), { title: 'An', reason: 'Zeitplan · bis 22:30', next: 'Danach Nachtuhr ab 22:30' });
  const manual = { timezone: tz, effective: { display: 'off', source: 'override', reason: 'Manuell aus', until: now + 30 * 60_000, next: null } };
  assert.deepEqual(describe(manual, now), { title: 'Aus', reason: 'Manuell aus · noch 30 Min.', next: '' });
});

test('glass preference clamps values and adjusts surface properties', async () => {
  const moduleUrl = new URL('../web/js/glass.js', import.meta.url);
  assert.ok(existsSync(fileURLToPath(moduleUrl)), 'glass preference module exists');
  const { applyGlass, normalizeGlass } = await import(moduleUrl.href);
  const cssValues = new Map();
  const stage = { style: { setProperty: (key, value) => cssValues.set(key, value) } };

  assert.equal(normalizeGlass(undefined), 55);
  assert.equal(normalizeGlass(150), 100);
  applyGlass(stage, 0);
  const clearBlur = cssValues.get('--glass-blur');
  const clearFill = cssValues.get('--glass-base');
  applyGlass(stage, 100);
  assert.notEqual(cssValues.get('--glass-blur'), clearBlur);
  assert.notEqual(cssValues.get('--glass-base'), clearFill);
  assert.equal(cssValues.get('--glass-blur'), '40px');
  assert.equal(applyGlass(stage, -10), 0);
});

test('tile and music glass effects read the adjustable surface variables', () => {
  const dashboardCss = readFileSync(new URL('../web/css/dashboard.css', import.meta.url), 'utf8');
  const tile = dashboardCss.match(/\.t\s*\{([^}]*)\}/)?.[1] ?? '';
  const info = dashboardCss.match(/\.stage\[data-music="1"\]\s+\.pinfo\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(tile, /blur\(var\(--glass-blur\)\)/);
  assert.match(tile, /var\(--glass-base\)/);
  assert.match(info, /blur\(var\(--glass-blur\)\)/);
  assert.match(info, /var\(--glass-base\)/);
});

test('ambient data is clamped and fresh readings preserve night mode', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(toWidgetData({
    available: true,
    ambientPercent: 142.6,
    dark: true,
    capturedAt: now,
  }, now), {
    available: true,
    ambientPercent: 100,
    dark: true,
    paused: false,
  });
});

test('stale or future ambient readings are unavailable and cannot enable night mode', () => {
  const now = 1_800_000_000_000;
  for (const capturedAt of [now - 30_000, now + 5_001]) {
    assert.deepEqual(toWidgetData({
      available: true,
      ambientPercent: 20,
      dark: true,
      capturedAt,
    }, now), {
      available: false,
      ambientPercent: null,
      dark: false,
      paused: false,
    });
  }
});
