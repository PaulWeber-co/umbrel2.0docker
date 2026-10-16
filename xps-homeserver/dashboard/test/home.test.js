import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import home, { baseUrl, displayFor, iconFor, parseEntities, toggleTarget, toWidgetData } from '../server/widgets/home.js';
import { render } from '../web/js/widgets/home.js';

const states = JSON.parse(readFileSync(new URL('./fixtures/ha-states.json', import.meta.url), 'utf8'));

const HA = 'http://umbrel.local:8123';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ4cHMtZGFzaGJvYXJkIn0.hAsEcReT4711';
const ENTITIES =
  'light.wohnzimmer=Wohnzimmer, sensor.wohnzimmer_temperature=innen, sensor.waschmaschine_restzeit=Wäsche, binary_sensor.balkontuer=Balkontür';
const SETTINGS = { DASH_HA_URL: `${HA}/`, DASH_HA_TOKEN: TOKEN, DASH_HA_ENTITIES: ENTITIES };

const config = (env = {}) => loadConfig({ argv: [], env, envFile: '/nonexistent' });

// Home Assistant's answer to the toggle: the states that changed meanwhile.
const toggled = () => [{ ...structuredClone(states.find((s) => s.entity_id === 'light.wohnzimmer')), state: 'off' }];

// A ctx like the hub's, but fetchJson answers from the fixture and records
// every request with its options.
function stub(env = SETTINGS, { demo = false, payload, fail } = {}) {
  const calls = [];
  const ctx = {
    config: config(env),
    log: { info() {}, warn() {}, error() {} },
    now: () => new Date('2026-10-16T09:24:00+02:00'),
    store: { read: async (_, fallback) => fallback, write: async () => {} },
    demo,
    payload,
    fetchJson: async (url, options = {}) => {
      calls.push({ url, ...options });
      if (fail) throw new Error(fail);
      if (url === `${HA}/api/states`) return structuredClone(states);
      if (url === `${HA}/api/services/homeassistant/toggle`) return toggled();
      throw new Error(`unexpected request ${url}`);
    },
    fetchText: async (url) => {
      calls.push({ url });
      throw new Error(`unexpected request ${url}`);
    },
  };
  return { ctx, calls };
}

const status400 = (error) => error.status === 400;
const byId = (data) => Object.fromEntries(data.entities.map((item) => [item.id, item]));

test('DASH_HA_ENTITIES: order, labels, spaces and empty parts', () => {
  assert.deepEqual(parseEntities(' light.wohnzimmer = Wohnzimmer ,, sensor.wohnzimmer_temperature=innen , ,binary_sensor.balkontuer,'), [
    { id: 'light.wohnzimmer', label: 'Wohnzimmer' },
    { id: 'sensor.wohnzimmer_temperature', label: 'innen' },
    { id: 'binary_sensor.balkontuer', label: null },
  ]);
  assert.deepEqual(parseEntities('sensor.x='), [{ id: 'sensor.x', label: null }]);
  assert.deepEqual(parseEntities('sensor.x=a=b'), [{ id: 'sensor.x', label: 'a=b' }]);
  assert.deepEqual(parseEntities('Light.Flur=Flur, light.flur=doppelt'), [{ id: 'light.flur', label: 'Flur' }]);
  assert.deepEqual(parseEntities(''), []);
  assert.deepEqual(parseEntities(' , ,'), []);
  assert.throws(() => parseEntities('wohnzimmer=Licht'), /DASH_HA_ENTITIES.*"wohnzimmer"/);
  assert.throws(() => parseEntities('light.wohn zimmer'), /ungültige Entität/);
});

test('settings: URL normalised, all three keys required', () => {
  assert.equal(baseUrl('http://umbrel.local:8123/'), HA);
  assert.equal(baseUrl(' umbrel.local:8123 '), HA);
  assert.equal(baseUrl('https://ha.example.org//'), 'https://ha.example.org');
  assert.equal(baseUrl(''), '');
  assert.equal(home.isConfigured(config(SETTINGS)), true);
  assert.equal(home.isConfigured(config({ ...SETTINGS, DASH_HA_URL: '' })), false);
  assert.equal(home.isConfigured(config({ ...SETTINGS, DASH_HA_TOKEN: ' ' })), false);
  assert.equal(home.isConfigured(config({ ...SETTINGS, DASH_HA_ENTITIES: ' , =innen' })), false);
  assert.equal(home.isConfigured(config({})), false);
});

test('display: switches, numbers, doors, motion and texts in German', () => {
  const show = (domain, state, attributes) => displayFor({ domain, state, attributes });
  assert.equal(show('light', 'on'), 'an');
  assert.equal(show('switch', 'off'), 'aus');
  assert.equal(show('automation', 'on'), 'an');
  assert.equal(show('sensor', '21.46', { unit_of_measurement: '°C' }), '21,5 °C');
  assert.equal(show('sensor', '21.0', { unit_of_measurement: '°C' }), '21 °C');
  assert.equal(show('sensor', '32', { unit_of_measurement: 'min' }), '32 min');
  assert.equal(show('sensor', '45', { unit_of_measurement: '%' }), '45 %');
  assert.equal(show('sensor', '1234.56', { unit_of_measurement: 'kWh' }), '1.234,6 kWh');
  assert.equal(show('sensor', '-0.04', { unit_of_measurement: '°C' }), '0 °C');
  assert.equal(show('sensor', '-3.25'), '-3,2');
  for (const deviceClass of ['door', 'window', 'opening', 'garage_door']) {
    assert.equal(show('binary_sensor', 'on', { device_class: deviceClass }), 'offen');
    assert.equal(show('binary_sensor', 'off', { device_class: deviceClass }), 'zu');
  }
  for (const deviceClass of ['motion', 'occupancy', 'presence']) {
    assert.equal(show('binary_sensor', 'on', { device_class: deviceClass }), 'Bewegung');
    assert.equal(show('binary_sensor', 'off', { device_class: deviceClass }), 'ruhig');
  }
  assert.equal(show('binary_sensor', 'on', { device_class: 'running' }), 'an');
  assert.equal(show('binary_sensor', 'off'), 'aus');
  assert.equal(show('sensor', 'Schleudern'), 'Schleudern');
  assert.equal(show('sensor', 'on'), 'on');
  assert.equal(show('cover', 'open'), 'offen');
  assert.equal(show('person', 'not_home'), 'unterwegs');
  assert.equal(show('person', 'Büro'), 'Büro');
  for (const domain of ['light', 'sensor', 'binary_sensor', 'cover']) {
    assert.equal(show(domain, 'unavailable'), 'nicht erreichbar');
    assert.equal(show(domain, 'unknown'), 'nicht erreichbar');
  }
});

test('icons: bulb, temp, washer, home', () => {
  assert.equal(iconFor({ id: 'light.flur', name: 'Flur', domain: 'light' }), 'bulb');
  assert.equal(iconFor({ id: 'sensor.a', name: 'A', domain: 'sensor', attributes: { device_class: 'temperature' } }), 'temp');
  assert.equal(iconFor({ id: 'sensor.b', name: 'B', domain: 'sensor', attributes: { unit_of_measurement: '°C' } }), 'temp');
  assert.equal(iconFor({ id: 'sensor.waschmaschine_restzeit', name: 'Rest', domain: 'sensor' }), 'washer');
  assert.equal(iconFor({ id: 'sensor.dryer', name: 'Wäsche', domain: 'sensor' }), 'washer');
  assert.equal(iconFor({ id: 'switch.dishwasher', name: 'Spüler', domain: 'switch' }), 'washer');
  assert.equal(iconFor({ id: 'binary_sensor.balkontuer', name: 'Balkontür', domain: 'binary_sensor' }), 'home');
});

test('/api/states becomes the configured entities in order', () => {
  const entities = parseEntities(
    'binary_sensor.balkontuer, light.wohnzimmer=Wohnzimmer, sensor.wohnzimmer_temperature=innen, switch.gartenpumpe=Pumpe, light.flur, sensor.aussen_temperatur',
  );
  const data = toWidgetData(states, entities);
  assert.deepEqual(
    data.entities.map((item) => item.id),
    entities.map((entity) => entity.id),
  );
  assert.deepEqual(data.entities[0], {
    id: 'binary_sensor.balkontuer',
    name: 'Balkontür',
    domain: 'binary_sensor',
    state: 'off',
    display: 'zu',
    toggleable: false,
    on: false,
    icon: 'home',
    missing: false,
  });
  assert.deepEqual(data.entities[1], {
    id: 'light.wohnzimmer',
    name: 'Wohnzimmer',
    domain: 'light',
    state: 'on',
    display: 'an',
    toggleable: true,
    on: true,
    icon: 'bulb',
    missing: false,
  });
  const temperature = data.entities[2];
  assert.equal(temperature.display, '21,5 °C');
  assert.equal(temperature.state, '21.46');
  assert.equal(temperature.on, null);
  assert.equal(temperature.icon, 'temp');

  // not in Home Assistant at all
  assert.deepEqual(data.entities[3], {
    id: 'switch.gartenpumpe',
    name: 'Pumpe',
    domain: 'switch',
    state: 'unavailable',
    display: 'nicht erreichbar',
    toggleable: true,
    on: false,
    icon: 'home',
    missing: true,
  });
  // known but offline: friendly_name stands in for the missing label
  assert.equal(data.entities[4].name, 'Flur');
  assert.equal(data.entities[4].display, 'nicht erreichbar');
  assert.equal(data.entities[4].missing, false);
  assert.equal(data.entities[5].name, 'Außentemperatur');
  assert.equal(data.entities[5].display, 'nicht erreichbar');

  // an unknown id without label falls back to the id itself
  assert.equal(toWidgetData([], parseEntities('sensor.weg')).entities[0].name, 'sensor.weg');
  assert.throws(() => toWidgetData({ message: 'API running.' }, entities), /unerwartete Antwort/);
});

test('every fixture entity gets a German display', () => {
  const data = byId(toWidgetData(states, parseEntities(states.map((s) => s.entity_id).join(','))));
  assert.equal(data['sensor.wohnzimmer_humidity'].display, '45,2 %');
  assert.equal(data['sensor.strom_heute'].display, '4,8 kWh');
  assert.equal(data['sensor.waschmaschine_restzeit'].display, '32 min');
  assert.equal(data['sensor.waschmaschine_restzeit'].icon, 'washer');
  assert.equal(data['sensor.waschmaschine_programmphase'].display, 'Schleudern');
  assert.equal(data['binary_sensor.kuechenfenster'].display, 'offen');
  assert.equal(data['binary_sensor.flur_bewegung'].display, 'Bewegung');
  assert.equal(data['binary_sensor.waschmaschine_laeuft'].display, 'an');
  assert.equal(data['switch.kaffeemaschine'].display, 'aus');
  assert.equal(data['fan.bad_luefter'].toggleable, true);
  assert.equal(data['automation.licht_abends'].on, true);
  assert.equal(data['input_boolean.urlaubsmodus'].on, false);
  assert.equal(data['cover.wohnzimmer_rollo'].display, 'offen');
  assert.equal(data['cover.wohnzimmer_rollo'].toggleable, false);
  assert.equal(data['person.paul'].display, 'zu Hause');
  assert.equal(data['sun.sun'].display, 'above_horizon');
});

test('fetch() asks /api/states once with the token in the header', async () => {
  const { ctx, calls } = stub();
  const data = await home.fetch(ctx);
  assert.deepEqual(calls, [{ url: `${HA}/api/states`, headers: { authorization: `Bearer ${TOKEN}` } }]);
  assert.deepEqual(
    data.entities.map((item) => [item.name, item.display]),
    [
      ['Wohnzimmer', 'an'],
      ['innen', '21,5 °C'],
      ['Wäsche', '32 min'],
      ['Balkontür', 'zu'],
    ],
  );
  assert.ok(!calls[0].url.includes(TOKEN));
});

test('errors name the token setting but never the token', async () => {
  const { ctx } = stub(SETTINGS, { fail: `GET ${HA}/api/states: HTTP 401` });
  await assert.rejects(home.fetch(ctx), (error) => /HTTP 401/.test(error.message) && /DASH_HA_TOKEN/.test(error.message));
  const leaky = stub(SETTINGS, { fail: `upstream said: Bearer ${TOKEN} invalid` });
  await assert.rejects(home.fetch(leaky.ctx), (error) => !error.message.includes(TOKEN) && error.message.includes('Bearer …'));
});

test('toggle rejects payloads for anything but configured switchable entities', async () => {
  const entities = parseEntities(ENTITIES);
  assert.equal(toggleTarget({ id: 'light.wohnzimmer' }, entities), 'light.wohnzimmer');
  for (const payload of [undefined, null, 'light.wohnzimmer', [], {}, { id: '' }, { id: 42 }, { entity_id: 'light.wohnzimmer' }]) {
    assert.throws(() => toggleTarget(payload, entities), status400, JSON.stringify(payload));
  }
  assert.throws(() => toggleTarget({ id: 'light.kueche' }, entities), (e) => status400(e) && /nicht in DASH_HA_ENTITIES/.test(e.message));
  assert.throws(() => toggleTarget({ id: 'sensor.wohnzimmer_temperature' }, entities), (e) => status400(e) && /nicht schalten/.test(e.message));
  assert.throws(() => toggleTarget({ id: 'LIGHT.WOHNZIMMER' }, entities), status400);

  for (const payload of [{}, { id: 'lock.haustuer' }, { id: 'binary_sensor.balkontuer' }]) {
    const { ctx, calls } = stub(SETTINGS, { payload });
    await assert.rejects(home.actions.toggle(ctx), status400);
    assert.equal(calls.length, 0, 'no request for an invalid payload');
  }
});

test('toggle posts homeassistant.toggle with JSON body and Bearer token', async () => {
  const { ctx, calls } = stub(SETTINGS, { payload: { id: 'light.wohnzimmer' } });
  assert.deepEqual(await home.actions.toggle(ctx), { id: 'light.wohnzimmer' });
  assert.deepEqual(calls, [
    {
      url: `${HA}/api/services/homeassistant/toggle`,
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{"entity_id":"light.wohnzimmer"}',
    },
  ]);
});

test('demo toggle flips the demo light without any request', async () => {
  const { ctx, calls } = stub({}, { demo: true, payload: { id: 'light.wohnzimmer' } });
  const light = () => home.demo(ctx).entities.find((item) => item.id === 'light.wohnzimmer');
  const before = light().on;
  await home.actions.toggle(ctx);
  assert.equal(light().on, !before);
  assert.equal(light().display, before ? 'aus' : 'an');
  assert.equal(light().state, before ? 'off' : 'on');
  await home.actions.toggle(ctx);
  assert.equal(light().on, before);
  assert.equal(calls.length, 0);

  for (const payload of [{ id: 'sensor.wohnzimmer_temperature' }, { id: 'light.kueche' }, null]) {
    await assert.rejects(home.actions.toggle({ ...ctx, payload }), status400);
  }
  assert.equal(light().on, before);
});

test('demo data: German sample entities', () => {
  const data = home.demo({});
  assert.deepEqual(
    data.entities.map((item) => [item.name, item.display, item.icon]),
    [
      ['Wohnzimmer', 'an', 'bulb'],
      ['innen', '21,5 °C', 'temp'],
      ['Wäsche', '32 min', 'washer'],
      ['Balkontür', 'zu', 'home'],
    ],
  );
  assert.equal(data.entities[0].toggleable, true);
  assert.equal(data.entities[3].domain, 'binary_sensor');
  assert.equal(data.entities[3].on, false);
});

test('demo data has the same shape as real data', async () => {
  const { ctx } = stub();
  const real = await home.fetch(ctx);
  const demo = home.demo({});
  const shape = (value) =>
    Array.isArray(value)
      ? value.map(shape)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]))
        : typeof value;
  // on is a boolean for switches and binary sensors, null otherwise
  const items = (data) => shape(data).entities.map((item) => ({ ...item, on: 'boolean|null' }));
  assert.deepEqual(Object.keys(demo), Object.keys(real));
  assert.equal(demo.entities.length, real.entities.length);
  assert.deepEqual(items(demo), items(real));
  for (const data of [demo, real]) {
    for (const item of data.entities) assert.ok(item.on === null || typeof item.on === 'boolean');
  }
});

const decode = (text) =>
  text.replace(/&(quot|#39|amp|lt|gt);/g, (_, name) => ({ quot: '"', '#39': "'", amp: '&', lt: '<', gt: '>' })[name]);
const payloadOf = (html) => JSON.parse(decode(html.match(/data-payload='([^']*)'/)[1]));
const rowCount = (html) => (html.match(/class="row ho-row/g) ?? []).length;

test('tile: loading, switch with JSON payload and two rows', () => {
  const loading = render(null);
  assert.match(loading, /#i-home/);
  assert.match(loading, /Zuhause/);
  assert.match(loading, /class="loading">Lädt …/);

  const html = render(home.demo({}), { compact: false });
  assert.match(html, /<div class="lbl"><svg class="ic" aria-hidden="true"><use href="#i-home"\/><\/svg>Zuhause<\/div>/);
  assert.match(html, /<button class="switch ho-switch" type="button" data-action="toggle" data-payload='[^']*' aria-pressed="(true|false)">/);
  assert.deepEqual(payloadOf(html), { id: 'light.wohnzimmer' });
  assert.match(html, /#i-bulb.*Wohnzimmer.*<i class="knob"><\/i><\/button>/s);
  assert.equal(rowCount(html), 2);
  assert.match(html, /<b class="ho-val">21,5 °C<\/b><span class="ho-name ho-muted">innen<\/span>/);
  assert.match(html, /<b class="ho-val">32 min<\/b><span class="ho-name ho-muted">Wäsche<\/span>/);
  assert.doesNotMatch(html, /Balkontür/);
  // music mode: same markup, w-home.css adapts to the narrower tile
  assert.equal(render(home.demo({}), { compact: true }), html);
});

test('tile: aria-pressed follows the light, values are escaped', () => {
  const item = {
    id: "light.o'neil",
    name: '<b>Bar & "Lounge"</b>',
    domain: 'light',
    state: 'off',
    display: 'aus',
    toggleable: true,
    on: false,
    icon: 'bulb',
    missing: false,
  };
  const html = render({ entities: [item] });
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /&lt;b&gt;Bar &amp; &quot;Lounge&quot;&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Bar/);
  assert.deepEqual(payloadOf(html), { id: "light.o'neil" });
});

test('tile: offline entities say "nicht erreichbar", an offline switch is disabled', () => {
  const data = toWidgetData(
    states,
    parseEntities('sensor.wohnzimmer_temperature=innen, light.flur, sensor.aussen_temperatur=außen, switch.gartenpumpe=Pumpe, binary_sensor.balkontuer'),
  );
  // light.flur is the first switchable entity but offline
  const html = render(data);
  assert.match(html, /<button class="switch ho-switch ho-na" type="button" aria-pressed="false" disabled>/);
  assert.doesNotMatch(html, /data-action/);
  assert.match(html, /Flur<\/span><small class="ho-muted">nicht erreichbar<\/small>/);
  assert.equal(rowCount(html), 2);
  assert.match(html, /<b class="ho-val">21,5 °C<\/b><span class="ho-name ho-muted">innen<\/span>/);
  assert.match(html, /<div class="row ho-row ho-na">.*außen<\/span><small class="ho-muted">nicht erreichbar<\/small>/s);
  assert.doesNotMatch(html, /Pumpe/);
});

test('tile: without a switchable entity up to three rows, empty list explained', () => {
  const data = toWidgetData(
    states,
    parseEntities('sensor.wohnzimmer_temperature=innen, sensor.keller_feuchte=Keller, binary_sensor.balkontuer, sensor.strom_heute'),
  );
  const html = render(data, { compact: true });
  assert.doesNotMatch(html, /<button/);
  assert.equal(rowCount(html), 3);
  assert.match(html, /Keller<\/span><small class="ho-muted">nicht erreichbar<\/small>/);
  assert.match(html, /<b class="ho-val">zu<\/b><span class="ho-name ho-muted">Balkontür<\/span>/);
  assert.doesNotMatch(html, /Stromverbrauch/);

  assert.match(render({ entities: [] }), /Keine Geräte eingestellt/);
});
