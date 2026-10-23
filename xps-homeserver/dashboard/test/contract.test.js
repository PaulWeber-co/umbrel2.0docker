// Every data source follows the hub contract and has a tile renderer or a
// same-named feature module. New widgets are checked automatically.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import widgets from '../server/widgets/index.js';

const config = loadConfig({ argv: ['--demo'], env: {}, envFile: '/nonexistent' });
const ctx = { config, store: { read: async (_, fallback) => fallback, write: async () => {} }, log: console, now: () => new Date('2026-10-15T07:42:00+02:00') };
// Widgets without a tile drive a feature module instead (web/js/features/),
// or the control center on the server (the dark room → night clock)
const FEATURE = { music: '../web/js/features/music.js', ambient: '../server/control.js' };

for (const widget of widgets) {
  test(`widget ${widget.id} follows the contract`, async () => {
    assert.match(widget.id, /^[a-z0-9-]+$/);
    assert.ok(Number.isInteger(widget.intervalMs) && widget.intervalMs >= 1000, 'intervalMs ≥ 1000');
    assert.equal(typeof widget.fetch, 'function');
    assert.equal(typeof widget.demo, 'function');
    const data = await widget.demo(ctx);
    assert.ok(data && typeof data === 'object', 'demo() returns an object');
    assert.doesNotThrow(() => JSON.stringify(data));
    const consumer = FEATURE[widget.id] ?? `../web/js/widgets/${widget.id}.js`;
    assert.ok(existsSync(new URL(consumer, import.meta.url)), `${consumer.slice(3)} exists`);
  });
}

test('widget ids are unique', () => {
  const ids = widgets.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
});
