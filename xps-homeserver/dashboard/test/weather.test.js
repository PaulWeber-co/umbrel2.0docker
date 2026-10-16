import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import weather, { compass, describe, toWidgetData } from '../server/widgets/weather.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/open-meteo.json', import.meta.url), 'utf8'));

test('WMO codes map to German text and an icon', () => {
  assert.deepEqual(describe(0), { text: 'Klar', icon: 'sun' });
  assert.equal(describe(63).icon, 'rain');
  assert.equal(describe(1234).text, 'Unbekannt');
});

test('wind direction as compass point', () => {
  assert.equal(compass(0), 'N');
  assert.equal(compass(173), 'S');
  assert.equal(compass(270), 'W');
  assert.equal(compass(350), 'N');
});

test('Open-Meteo answer becomes widget data', () => {
  const data = toWidgetData(fixture, { place: 'Hamburg' });
  assert.equal(data.place, 'Hamburg');
  assert.equal(typeof data.now.temp, 'number');
  assert.match(data.sun.sunrise, /^\d\d:\d\d$/);
  assert.match(data.sun.sunset, /^\d\d:\d\d$/);
  assert.equal(data.hours.length, 5);
  for (const hour of data.hours) assert.match(hour.label, /^\d{1,2} Uhr$/);
});

test('demo data has the same shape as real data', () => {
  const real = toWidgetData(fixture, { place: 'Hamburg' });
  const demo = weather.demo({ config: { place: 'Hamburg' } });
  const shape = (value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]))
      : Array.isArray(value) ? 'array' : typeof value;
  const realShape = shape(real);
  realShape.today.rainFrom = 'string|null';
  const demoShape = shape(demo);
  demoShape.today.rainFrom = 'string|null';
  assert.deepEqual(demoShape, realShape);
});
