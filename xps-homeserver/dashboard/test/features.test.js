import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { toWidgetData } from '../server/widgets/ambient.js';
import { parseMetadata } from '../server/widgets/music.js';
import { render as renderHome } from '../web/js/widgets/home.js';

test('home widget switches to a compact single-column list in music mode', () => {
  const devices = [
    { name: 'Wohnzimmerlicht', state: 'on', domain: 'light', unit: '', controllable: false },
    { name: 'Temperatur Wohnzimmer', state: '21,5', domain: 'sensor', unit: '°C', controllable: false },
    { name: 'Kaffeemaschine', state: 'off', domain: 'switch', unit: '', controllable: false },
  ];
  const compact = renderHome(devices, { compact: true });
  const normal = renderHome(devices);

  assert.match(compact, /class="home-list home-list-compact"/);
  assert.doesNotMatch(normal, /home-list-compact/);
});

test('AirPlay styles elevate the player and give its metadata a glass surface', () => {
  const css = readFileSync(new URL('../web/css/dashboard.css', import.meta.url), 'utf8');
  const player = css.match(/\.player\s*\{([^}]*)\}/)?.[1] ?? '';
  const playerInfo = css.match(/\.stage\[data-music="1"\]\s+\.pinfo\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(player, /top:\s*480px/);
  assert.match(player, /height:\s*520px/);
  assert.match(playerInfo, /backdrop-filter:/);
  assert.match(playerInfo, /border-radius:/);
});

test('glass slider lives in a hidden settings panel and the demo badge is removed', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

  assert.match(html, /id="glass-settings-toggle"/);
  assert.match(html, /id="glass-settings-overlay"[^>]*hidden/);
  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /<input[^>]*id="glass-level"[^>]*type="range"/);
  assert.match(html, /Klar/);
  assert.match(html, /Milchig/);
  assert.doesNotMatch(html, /class="glass-control"/);
  assert.doesNotMatch(html, /id="chip-demo"/);
});

test('glass slider persists through shared dashboard settings', () => {
  const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');

  assert.match(app, /fetch\('\/api\/settings'/);
  assert.match(app, /addEventListener\('settings'/);
  assert.doesNotMatch(app, /saveGlass\s*\(|glassStorage|localStorage/);
});

test('glass settings trap focus and close with Escape, outside click, or the close button', async () => {
  const moduleUrl = new URL('../web/js/glass.js', import.meta.url);
  const { initGlassSettings } = await import(moduleUrl.href);
  assert.equal(typeof initGlassSettings, 'function');
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
  const close = fakeTarget();
  const slider = fakeTarget();
  const keyboard = fakeTarget();
  Object.defineProperty(keyboard, 'activeElement', { get: () => focusState.activeElement });
  const overlay = fakeTarget();
  overlay.hidden = false;

  initGlassSettings({ toggle, overlay, slider, close, keyboard });
  assert.equal(overlay.hidden, true);
  assert.equal(toggle.attributes.get('aria-expanded'), 'false');
  toggle.fire('click');
  assert.equal(overlay.hidden, false);
  assert.equal(toggle.attributes.get('aria-expanded'), 'true');
  assert.equal(slider.focused, true);
  let prevented = false;
  keyboard.fire('keydown', { key: 'Tab', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(focusState.activeElement, close);
  keyboard.fire('keydown', { key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } });
  assert.equal(focusState.activeElement, slider);
  keyboard.fire('keydown', { key: 'Escape' });
  assert.equal(overlay.hidden, true);
  assert.equal(toggle.focused, true);
  toggle.fire('click');
  overlay.fire('click', { target: overlay });
  assert.equal(overlay.hidden, true);
  toggle.fire('click');
  close.fire('click');
  assert.equal(overlay.hidden, true);
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

test('compact home styles use one column and truncate long device names', () => {
  const css = readFileSync(new URL('../web/css/w-tiles.css', import.meta.url), 'utf8');
  const compact = css.match(/\.home-list-compact\s*\{([^}]*)\}/)?.[1] ?? '';
  const names = css.match(/\.home-list-compact[^}]*\.home-state\s*>\s*span\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(compact, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(names, /text-overflow:\s*ellipsis/);
});

test('ambient data is clamped and fresh readings preserve night mode', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(toWidgetData({
    available: true,
    ambientPercent: 42.6,
    backlightPercent: 104,
    dark: true,
    capturedAt: now,
  }, now), {
    available: true,
    ambientPercent: 43,
    backlightPercent: 100,
    dark: true,
  });
});

test('stale or future ambient readings are unavailable and cannot enable night mode', () => {
  const now = 1_800_000_000_000;
  for (const capturedAt of [now - 30_000, now + 5_001]) {
    assert.deepEqual(toWidgetData({
      available: true,
      ambientPercent: 20,
      backlightPercent: 30,
      dark: true,
      capturedAt,
    }, now), {
      available: false,
      ambientPercent: null,
      backlightPercent: null,
      dark: false,
    });
  }
});

test('AirPlay XML metadata decodes title and artwork payloads', () => {
  const packet = [
    '<item><type>7374726d</type><code>6d696e6d</code><data encoding="base64">VGVzdCB0cmFjaw==</data></item>',
    '<item><type>7374726d</type><code>70696374</code><data encoding="base64">iVBORw0KGgo=</data></item>',
  ].join('');
  const items = parseMetadata(packet);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(({ type, code, bytes }) => [type, code, code === 'pict' ? bytes.toString('hex') : bytes.toString('utf8')]), [
    ['strm', 'minm', 'Test track'],
    ['strm', 'pict', '89504e470d0a1a0a'],
  ]);
});
