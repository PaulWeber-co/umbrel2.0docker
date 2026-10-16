// Every widget must follow the contract described in server/hub.js and have a
// front-end module with the same id. New widgets are checked automatically.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import widgets from '../server/widgets/index.js';

const config = loadConfig({ argv: ['--demo'], env: {}, envFile: '/nonexistent' });
const ctx = { config, store: { read: async (_, fallback) => fallback, write: async () => {} }, log: console, now: () => new Date('2026-10-15T07:42:00+02:00') };

for (const widget of widgets) {
  test(`widget ${widget.id} follows the contract`, async () => {
    assert.match(widget.id, /^[a-z0-9-]+$/);
    assert.ok(Number.isInteger(widget.intervalMs) && widget.intervalMs >= 1000, 'intervalMs ≥ 1000');
    assert.equal(typeof widget.fetch, 'function');
    assert.equal(typeof widget.demo, 'function');
    const data = await widget.demo(ctx);
    assert.ok(data && typeof data === 'object', 'demo() returns an object');
    assert.doesNotThrow(() => JSON.stringify(data));
    assert.ok(existsSync(new URL(`../web/js/widgets/${widget.id}.js`, import.meta.url)), `web/js/widgets/${widget.id}.js exists`);
  });
}

test('widget ids are unique', () => {
  const ids = widgets.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
});
