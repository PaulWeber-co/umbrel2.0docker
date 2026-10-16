import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hub, redact } from '../server/hub.js';

const quiet = { warn() {}, log() {}, error() {} };
const store = { read: async (_, fallback) => fallback, write: async () => {} };

function widget(overrides = {}) {
  return { id: 'probe', intervalMs: 60_000, fetch: async () => ({ source: 'real' }), demo: () => ({ source: 'demo' }), ...overrides };
}

test('real data when configured, demo data in demo mode', async () => {
  const real = new Hub({ widgets: [widget()], config: { demo: false }, store, log: quiet });
  assert.equal((await real.refresh('probe')).data.source, 'real');
  const demo = new Hub({ widgets: [widget()], config: { demo: true }, store, log: quiet });
  const entry = await demo.refresh('probe');
  assert.equal(entry.data.source, 'demo');
  assert.equal(entry.demo, true);
});

test('missing settings fall back to demo data', async () => {
  const hub = new Hub({ widgets: [widget({ isConfigured: () => false })], config: { demo: false }, store, log: quiet });
  assert.equal((await hub.refresh('probe')).data.source, 'demo');
});

test('a failure keeps the last good data and backs off', async () => {
  let fail = false;
  const hub = new Hub({
    widgets: [widget({ fetch: async () => { if (fail) throw new Error('down'); return { n: 1 }; } })],
    config: { demo: false },
    store,
    log: quiet,
  });
  await hub.refresh('probe');
  fail = true;
  const entry = await hub.refresh('probe');
  assert.deepEqual(entry.data, { n: 1 });
  assert.equal(entry.error, 'down');
  assert.equal(hub.delayFor('probe'), 30_000);
  await hub.refresh('probe');
  assert.equal(hub.delayFor('probe'), 60_000);
});

test('subscribers hear about changes, not repeats', async () => {
  let n = 0;
  const hub = new Hub({ widgets: [widget({ fetch: async () => ({ n: Math.floor(n++ / 2) }) })], config: { demo: false }, store, log: quiet });
  const seen = [];
  const off = hub.subscribe((entry) => seen.push(entry.data.n));
  await hub.refresh('probe'); // n 0
  await hub.refresh('probe'); // still 0: not sent again
  await hub.refresh('probe'); // 1
  off();
  await hub.refresh('probe');
  assert.deepEqual(seen, [0, 1]);
});

test('push sources publish through watch(), not in demo mode', async () => {
  let emit;
  let stopped = false;
  const pushing = widget({ watch: (_ctx, e) => { emit = e; return () => { stopped = true; }; } });
  const hub = new Hub({ widgets: [pushing], config: { demo: false }, store, log: quiet });
  const seen = [];
  hub.subscribe((entry) => seen.push(entry.data));
  hub.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  emit({ playing: true });
  assert.deepEqual(seen.at(-1), { playing: true });
  hub.stop();
  assert.equal(stopped, true);

  let watched = false;
  const demoHub = new Hub({ widgets: [widget({ watch: () => { watched = true; } })], config: { demo: true }, store, log: quiet });
  demoHub.start();
  demoHub.stop();
  assert.equal(watched, false);
});

test('actions run and refresh the widget', async () => {
  let toggled = 0;
  const hub = new Hub({
    widgets: [widget({ actions: { toggle: async ({ payload }) => { toggled += payload.by; return 'ok'; } } })],
    config: { demo: false },
    store,
    log: quiet,
  });
  assert.equal(await hub.action('probe', 'toggle', { by: 2 }), 'ok');
  assert.equal(toggled, 2);
  assert.ok(hub.snapshot().probe);
  await assert.rejects(hub.action('probe', 'nope', {}), /kennt die Aktion/);
});

test('API keys never reach logs', () => {
  assert.equal(redact('https://x/route?key=abc123&traffic=true'), 'https://x/route?key=…&traffic=true');
  assert.equal(redact('https://x/a.json?auth=secret'), 'https://x/a.json?auth=…');
});
