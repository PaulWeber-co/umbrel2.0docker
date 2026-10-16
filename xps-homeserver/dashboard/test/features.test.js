import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toWidgetData } from '../server/widgets/ambient.js';
import { parseMetadata } from '../server/widgets/music.js';

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
