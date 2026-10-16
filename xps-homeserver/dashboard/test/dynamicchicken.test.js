import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import dc, {
  baseUrl,
  count,
  failedKpi,
  hideSecret,
  kpiUrl,
  parseKpis,
  relativeTime,
  sum,
  toDate,
  toKpi,
} from '../server/widgets/dynamicchicken.js';
import { decimals, fit, render, text } from '../web/js/widgets/dc.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/firebase-${name}.json`, import.meta.url), 'utf8'));

const DB = 'https://dynamicchicken-default-rtdb.europe-west1.firebasedatabase.app';
// Looks like a legacy database secret: 40 letters and digits
const SECRET = 'Xk9pQ2vL7mN4rT8sW1yZ3bC6dF0gH5jK2aE7uI9o';
const NOW = new Date('2026-10-16T07:42:00+02:00');
const KPIS = 'Hühner=chickens|count; Eier heute=stats/eggsToday; Zuletzt aktiv=/lastActivity|time';
const config = (env) => loadConfig({ argv: [], env, envFile: '/nonexistent' });
const opts = { now: NOW, timeZone: 'Europe/Berlin' };
const ago = (ms) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

// What the database answers, by request path; "?shallow" is the answer to
// shallow=true. Like Firebase, a shallow request without its own fixture gets
// the child keys mapped to true, and a path that is not listed answers null.
const ANSWERS = {
  '/chickens.json': 'chickens',
  '/chickens.json?shallow': 'chickens-shallow',
  '/stats/eggsToday.json': 'eggs-today',
  '/stats/eggsWeek.json': 'eggs-week',
  '/stats/status.json': 'status',
  '/feed/kg.json': 'feed-kg',
  '/lastActivity.json': 'last-activity',
  '/sync/last.json': 'last-sync',
};

function answer(pathname, shallow) {
  if (shallow && ANSWERS[`${pathname}?shallow`]) return fixture(ANSWERS[`${pathname}?shallow`]);
  const full = fixture(ANSWERS[pathname] ?? 'missing');
  if (!shallow || full === null || typeof full !== 'object') return full;
  return Object.fromEntries(Object.keys(full).map((key) => [key, true]));
}

// ctx stub: answers every request from the fixtures (or with an HTTP error
// that still contains the raw URL, so the widget has to scrub the secret
// itself), records the requests, log lines and how many ran at once.
function stub({ env = {}, fail = {} } = {}) {
  const calls = [];
  const logs = [];
  const stats = { inFlight: 0, maxInFlight: 0 };
  const fetchJson = async (url, options = {}) => {
    calls.push({ url, ...options });
    stats.maxInFlight = Math.max(stats.maxInFlight, ++stats.inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    stats.inFlight--;
    const { pathname, searchParams } = new URL(url);
    if (fail[pathname]) throw new Error(`GET ${url}: HTTP ${fail[pathname]}`);
    return answer(pathname, searchParams.get('shallow') === 'true');
  };
  const ctx = {
    config: config({ DASH_DC_DB_URL: `${DB}/`, DASH_DC_AUTH: SECRET, DASH_DC_KPIS: KPIS, ...env }),
    fetchJson,
    fetchText: async () => assert.fail('fetchText is not used'),
    now: () => NOW,
    log: { info: (line) => logs.push(line), warn: (line) => logs.push(line), error: (line) => logs.push(line) },
  };
  return { ctx, calls, logs, stats };
}

const ALL_FAIL = { '/chickens.json': 401, '/stats/eggsToday.json': 401, '/lastActivity.json': 401 };

test('key figures: labels, paths and modes, spaces and a leading slash do not matter', () => {
  assert.deepEqual(parseKpis(KPIS), [
    { label: 'Hühner', path: 'chickens', mode: 'count' },
    { label: 'Eier heute', path: 'stats/eggsToday', mode: 'value' },
    { label: 'Zuletzt aktiv', path: 'lastActivity', mode: 'time' },
  ]);
  assert.deepEqual(parseKpis('  Futter  =  /feed//kg/ | SUM ;; '), [{ label: 'Futter', path: 'feed/kg', mode: 'sum' }]);
  assert.deepEqual(parseKpis('Status=stats/status|value'), [{ label: 'Status', path: 'stats/status', mode: 'value' }]);
  for (const bad of [
    'Hühner',
    '=chickens',
    'Hühner=',
    'Hühner=/',
    'Hühner=chickens|',
    'Hühner=chickens|avg',
    'Eier=stats.eggs',
    'Eier=stats/../geheim',
    'Eier=stats/$key',
  ]) {
    assert.throws(() => parseKpis(bad), /^Error: DASH_DC_KPIS: ".*" ist ungültig/, bad);
  }
  assert.throws(() => parseKpis(' ; '), /keine Kennzahl/);
});

test('REST URL: path.json, shallow=true only for count, auth only when set', () => {
  assert.equal(kpiUrl(`${DB}/`, { path: 'chickens', mode: 'count' }), `${DB}/chickens.json?shallow=true`);
  assert.equal(kpiUrl(DB, { path: 'chickens', mode: 'count' }, SECRET), `${DB}/chickens.json?shallow=true&auth=${SECRET}`);
  assert.equal(kpiUrl(DB, { path: 'stats/eggsToday', mode: 'value' }), `${DB}/stats/eggsToday.json`);
  assert.equal(kpiUrl(DB, { path: 'stats/eggsWeek', mode: 'sum' }, SECRET), `${DB}/stats/eggsWeek.json?auth=${SECRET}`);
  assert.equal(kpiUrl(DB, { path: 'lastActivity', mode: 'time' }), `${DB}/lastActivity.json`);
  assert.equal(kpiUrl(DB, { path: 'Ställe/Nord Ost', mode: 'value' }), `${DB}/St%C3%A4lle/Nord%20Ost.json`);
  const token = 'eyJhbGciOiJSUzI1NiJ9.e30+/=';
  assert.equal(new URL(kpiUrl(DB, { path: 'x', mode: 'value' }, token)).searchParams.get('auth'), token);
  assert.equal(baseUrl(`${DB}//`), DB);
});

test('the secret is removed from messages in every spelling', () => {
  assert.equal(hideSecret(`GET ${DB}/a.json?auth=${SECRET}: HTTP 401`, SECRET), `GET ${DB}/a.json?auth=…: HTTP 401`);
  assert.equal(hideSecret(`token ${SECRET} abgelehnt`, SECRET), 'token … abgelehnt');
  // any other auth= in a URL goes through redact(), the status after it stays
  assert.equal(hideSecret(`GET ${DB}/a.json?shallow=true&auth=alt123: HTTP 401`, SECRET), `GET ${DB}/a.json?shallow=true&auth=…: HTTP 401`);
  assert.equal(hideSecret(`(${DB}/a.json?auth=alt123).`, ''), `(${DB}/a.json?auth=…).`);
  const token = 'eyJhbGciOiJSUzI1NiJ9.e30+/=';
  for (const form of [token, encodeURIComponent(token), new URLSearchParams({ a: token }).toString().slice(2)]) {
    const message = hideSecret(`kaputt bei ${form} und ?shallow=true&auth=${form}`, token);
    assert.ok(!message.includes(form), message);
    assert.ok(!message.includes('eyJhbGciOiJSUzI1NiJ9'), message);
  }
  assert.equal(hideSecret('fetch failed', ''), 'fetch failed');
});

test('mode value: number, text and yes/no as they are, objects do not fit', () => {
  const kpi = { label: 'Eier heute', mode: 'value' };
  assert.deepEqual(toKpi(kpi, fixture('eggs-today'), opts), { label: 'Eier heute', display: '4', value: 4, error: false });
  assert.deepEqual(toKpi(kpi, fixture('status'), opts), { label: 'Eier heute', display: 'Alle im Stall', value: 'Alle im Stall', error: false });
  assert.equal(toKpi(kpi, 18432, opts).display, '18.432');
  assert.equal(toKpi(kpi, 4.75, opts).display, '4,75');
  assert.equal(toKpi(kpi, 3.14159, opts).display, '3,14');
  assert.equal(toKpi(kpi, true, opts).display, 'ja');
  assert.equal(toKpi(kpi, false, opts).display, 'nein');
  assert.equal(toKpi(kpi, '   ', opts).display, '–');
  const long = toKpi(kpi, 'Gack '.repeat(60), opts).display;
  assert.equal(long.length, 100);
  assert.ok(long.endsWith('…'));
  assert.throws(() => toKpi(kpi, fixture('chickens'), opts), /Objekt/);
});

test('mode count: children of the shallow answer', () => {
  const shallow = fixture('chickens-shallow');
  assert.deepEqual(Object.keys(shallow), Object.keys(fixture('chickens')), 'the shallow fixture matches the full tree');
  assert.ok(Object.values(shallow).every((v) => v === true));
  assert.deepEqual(toKpi({ label: 'Hühner', mode: 'count' }, shallow, opts), { label: 'Hühner', display: '7', value: 7, error: false });
  assert.equal(count(fixture('chickens')), 7);
  assert.equal(count(fixture('feed-kg')), 4, 'array holes (null) are no children');
  assert.equal(count(Object.fromEntries(Array.from({ length: 1234 }, (_, i) => [`k${i}`, true]))), 1234);
  assert.equal(toKpi({ label: 'Viele', mode: 'count' }, Object.fromEntries(Array.from({ length: 1234 }, (_, i) => [`k${i}`, true])), opts).display, '1.234');
  assert.throws(() => count(fixture('eggs-today')), /kein Objekt/);
});

test('mode sum: numeric children added up', () => {
  assert.deepEqual(toKpi({ label: 'Eier Woche', mode: 'sum' }, fixture('eggs-week'), opts), {
    label: 'Eier Woche',
    display: '35',
    value: 35,
    error: false,
  });
  assert.equal(sum(fixture('feed-kg')), 10.6, 'array with a hole, no floating-point noise');
  assert.equal(toKpi({ label: 'Futter', mode: 'sum' }, fixture('feed-kg'), opts).display, '10,6');
  assert.equal(sum({ a: 2, b: 'drei', c: 3 }), 5, 'non-numbers are skipped');
  assert.equal(sum(4), 4);
  assert.throws(() => sum(fixture('chickens')), /keine Zahlen/);
  assert.throws(() => sum('viel'), /keine Zahl/);
});

test('mode time: German relative time at a fixed now in the configured zone', () => {
  assert.deepEqual(toKpi({ label: 'Zuletzt aktiv', mode: 'time' }, fixture('last-activity'), opts), {
    label: 'Zuletzt aktiv',
    display: 'vor 5 min',
    value: '2026-10-16T05:37:00.000Z',
    error: false,
  });
  assert.equal(toKpi({ label: 'Sync', mode: 'time' }, fixture('last-sync'), opts).display, 'gestern');

  const rel = (date, timeZone = 'Europe/Berlin') => relativeTime(new Date(date), NOW, timeZone);
  assert.equal(rel(ago(30_000)), 'gerade eben');
  assert.equal(rel(ago(-20_000)), 'gerade eben', 'a clock a little ahead');
  assert.equal(rel(ago(MIN)), 'vor 1 min');
  assert.equal(rel(ago(59 * MIN + 59_000)), 'vor 59 min');
  assert.equal(rel(ago(130 * MIN)), 'vor 2 h');
  assert.equal(rel('2026-10-16T00:10:00+02:00'), 'vor 7 h');
  assert.equal(rel('2026-10-15T23:50:00+02:00'), 'gestern');
  assert.equal(rel('2026-10-16T00:10:00+02:00', 'UTC'), 'gestern', 'still the 15th in UTC');
  assert.equal(rel('2026-10-13T09:00:00+02:00'), '13. Okt.');
  assert.equal(rel('2026-03-01T12:00:00+01:00'), '1. März');
  assert.equal(rel('2025-10-12T12:00:00+02:00'), '12. Okt. 2025');
  assert.equal(rel('2026-10-20T12:00:00+02:00'), '20. Okt.', 'future times show their date');

  const ms = fixture('last-activity');
  assert.equal(toDate(ms).toISOString(), '2026-10-16T05:37:00.000Z');
  assert.equal(toDate(String(ms)).getTime(), ms, 'digits as text');
  assert.equal(toDate(ms / 1000).getTime(), ms, 'seconds since 1970');
  assert.equal(toDate('2026-10-16T07:37:00+02:00').getTime(), ms);
  for (const bad of ['bald', '', true, {}, [], 1e20]) assert.throws(() => toDate(bad), /keine Zeitangabe/, String(bad));
});

test('a missing node (null) shows "–" and is no error', () => {
  for (const mode of ['value', 'count', 'sum', 'time']) {
    assert.deepEqual(toKpi({ label: 'Neu', mode }, fixture('missing'), opts), { label: 'Neu', display: '–', value: null, error: false });
  }
});

test('fetch asks for all key figures at once and converts them', async () => {
  const { ctx, calls, logs, stats } = stub();
  assert.deepEqual(await dc.fetch(ctx), {
    placeholder: false,
    kpis: [
      { label: 'Hühner', display: '7', value: 7, error: false },
      { label: 'Eier heute', display: '4', value: 4, error: false },
      { label: 'Zuletzt aktiv', display: 'vor 5 min', value: '2026-10-16T05:37:00.000Z', error: false },
    ],
  });
  assert.deepEqual(
    calls.map((c) => c.url).sort(),
    [
      `${DB}/chickens.json?shallow=true&auth=${SECRET}`,
      `${DB}/lastActivity.json?auth=${SECRET}`,
      `${DB}/stats/eggsToday.json?auth=${SECRET}`,
    ],
  );
  assert.equal(stats.maxInFlight, 3, 'requests run in parallel');
  assert.deepEqual(logs, []);
});

test('without DASH_DC_AUTH there is no auth parameter; missing nodes show "–"', async () => {
  const { ctx, calls } = stub({ env: { DASH_DC_AUTH: '', DASH_DC_KPIS: 'Neu=noch/nicht/da; Status=/stats/status' } });
  const data = await dc.fetch(ctx);
  assert.deepEqual(data.kpis, [
    { label: 'Neu', display: '–', value: null, error: false },
    { label: 'Status', display: 'Alle im Stall', value: 'Alle im Stall', error: false },
  ]);
  for (const { url } of calls) assert.equal(new URL(url).searchParams.has('auth'), false, url);
});

test('a failing key figure shows "–" and is marked, the others still show', async () => {
  const { ctx, logs } = stub({ fail: { '/stats/eggsToday.json': 503 } });
  const data = await dc.fetch(ctx);
  assert.deepEqual(data.kpis[1], failedKpi('Eier heute'));
  assert.deepEqual(data.kpis[1], { label: 'Eier heute', display: '–', value: null, error: true });
  assert.equal(data.kpis[0].display, '7');
  assert.equal(data.kpis[2].display, 'vor 5 min');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[dc\] Eier heute \(stats\/eggsToday\): GET .*auth=…: HTTP 503$/);
  assert.ok(!logs[0].includes(SECRET), 'secret not in the log');

  // A node that does not fit its mode fails the same way
  const mismatch = stub({ env: { DASH_DC_KPIS: 'Hühner=chickens; Eier heute=stats/eggsToday' } });
  const mixed = await dc.fetch(mismatch.ctx);
  assert.deepEqual(mixed.kpis[0], failedKpi('Hühner'));
  assert.equal(mixed.kpis[1].display, '4');
  assert.match(mismatch.logs[0], /Hühner \(chickens\) ist ein Objekt/);
});

test('all key figures failing throws, never with the secret', async () => {
  const { ctx, logs } = stub({ fail: ALL_FAIL });
  const error = await dc.fetch(ctx).catch((e) => e);
  assert.ok(error instanceof Error);
  assert.match(error.message, /^DynamicChicken: keine Kennzahl abrufbar, Hühner \(chickens\): GET .*: HTTP 401$/);
  assert.ok(!error.message.includes(SECRET), error.message);
  for (const line of logs) assert.ok(!line.includes(SECRET), line);

  const odd = 'geheim+/=token';
  const other = stub({ env: { DASH_DC_AUTH: odd }, fail: ALL_FAIL });
  const message = (await dc.fetch(other.ctx).catch((e) => e)).message;
  for (const form of [odd, encodeURIComponent(odd), new URLSearchParams({ a: odd }).toString().slice(2)]) {
    assert.ok(!message.includes(form), message);
  }

  const types = stub({ env: { DASH_DC_KPIS: 'Hühner=chickens; Status=stats/status|sum' } });
  await assert.rejects(dc.fetch(types.ctx), /keine Kennzahl abrufbar, Hühner \(chickens\) ist ein Objekt/);
});

test('settings: database URL and key figures are required, auth is optional', async () => {
  assert.equal(dc.isConfigured(config({})), false);
  assert.equal(dc.isConfigured(config({ DASH_DC_DB_URL: DB })), false);
  assert.equal(dc.isConfigured(config({ DASH_DC_KPIS: KPIS })), false);
  assert.equal(dc.isConfigured(config({ DASH_DC_DB_URL: '  ', DASH_DC_KPIS: KPIS })), false);
  assert.equal(dc.isConfigured(config({ DASH_DC_DB_URL: DB, DASH_DC_KPIS: '  ' })), false);
  assert.equal(dc.isConfigured(config({ DASH_DC_DB_URL: DB, DASH_DC_KPIS: KPIS })), true);
  assert.equal(dc.isConfigured(config({ DASH_DC_DB_URL: DB, DASH_DC_KPIS: KPIS, DASH_DC_AUTH: SECRET })), true);

  for (const url of ['dynamicchicken-default-rtdb.europe-west1.firebasedatabase.app', `${DB}/.json?auth=${SECRET}`, `${DB}#x`]) {
    const { ctx, calls } = stub({ env: { DASH_DC_DB_URL: url } });
    const error = await dc.fetch(ctx).catch((e) => e);
    assert.match(error.message, /^DASH_DC_DB_URL muss/);
    assert.ok(!error.message.includes(SECRET), error.message);
    assert.equal(calls.length, 0);
  }
  await assert.rejects(dc.fetch(stub({ env: { DASH_DC_KPIS: 'Hühner' } }).ctx), /DASH_DC_KPIS: "Hühner" ist ungültig/);
  assert.equal(dc.id, 'dc');
  assert.equal(dc.intervalMs, 5 * 60_000);
});

test('number formatting and size classes of the tile', () => {
  assert.equal(decimals(4), 0);
  assert.equal(decimals(4.5), 1);
  assert.equal(decimals(3.14159), 2);
  assert.equal(decimals(4.999), 0);
  assert.equal(decimals(-2.25), 2);
  assert.equal(text({ value: 18432, display: '18.432' }), '18.432');
  assert.equal(text({ value: 1234.5, display: '1.234,5' }), '1.234,5');
  assert.equal(text({ value: null, display: '–' }), '–');
  assert.equal(text({ value: '2026-10-15T18:20:31.512Z', display: 'gestern' }), 'gestern');
  assert.equal(text({ value: true, display: 'ja' }), 'ja');

  assert.equal(fit('7', true), '');
  assert.equal(fit('42,5', true), '');
  assert.equal(fit('nein', false), '');
  assert.equal(fit('1.234', true), ' long');
  assert.equal(fit('18.432', true), ' long dc-l6');
  assert.equal(fit('180.432', true), ' long dc-l7');
  assert.equal(fit('gestern', false), ' long dc-l7');
  assert.equal(fit('1.234,56', true), ' long dc-l8');
  assert.equal(fit('1.180.432', true), ' long dc-l9');
  assert.equal(fit('18.180.432', true), ' long dc-l10');
  assert.equal(fit('12. Okt.', false), ' long dc-l8 dc-wrap');
  assert.equal(fit('gerade eben', false), ' long dc-l8 dc-wrap');
});

test('tile: loading, placeholder, key figures, errors and escaping', async () => {
  const loading = render(null, { compact: false });
  assert.match(loading, /class="loading"/);
  assert.match(loading, /DynamicChicken/);

  const placeholder = render(dc.demo(), { compact: false });
  assert.match(placeholder, /class="ph dc-ph">\[Kennzahl\]</);
  assert.match(placeholder, /class="foot dc-hint">Kennzahlen in \.env eintragen \(DASH_DC_KPIS\)</);
  assert.match(placeholder, /<span class="dc-name">DynamicChicken<\/span>/);

  const data = await dc.fetch(stub().ctx);
  const html = render(data, { compact: false });
  assert.match(html, /class="big dc-big">7</);
  assert.match(html, /class="sub dc-line">Hühner</);
  assert.match(html, /class="foot dc-foot">Eier heute: 4</);
  assert.match(html, /class="dc"/);
  assert.match(render(data, { compact: true }), /class="dc compact"/);

  const one = (kpi, second) => render({ placeholder: false, kpis: second ? [kpi, second] : [kpi] }, {});
  assert.match(one({ label: 'Eier gesamt', display: '18.432', value: 18432, error: false }), /class="big dc-big long dc-l6">18\.432</);
  assert.match(one({ label: 'Futter', display: '4,75', value: 4.75, error: false }), />4,75</);
  const wrapped = one({ label: 'Zuletzt aktiv', display: 'vor 12 min', value: '2026-10-16T05:30:00.000Z', error: false });
  assert.match(wrapped, /class="big dc-big long dc-l8 dc-wrap">vor 12&nbsp;min</);
  assert.match(one({ label: 'Eier heute', display: '–', value: null, error: true }), /class="big dc-big dc-err">–</);
  assert.match(
    one({ label: 'Hühner', display: '7', value: 7, error: false }, { label: 'Zuletzt aktiv', display: 'vor 2 h', value: 'x', error: false }),
    /class="foot dc-foot">Zuletzt aktiv: vor 2&nbsp;h</,
  );
  assert.doesNotMatch(one({ label: 'Hühner', display: '7', value: 7, error: false }), /dc-foot/);

  const evil = one({ label: '<img src=x onerror=alert(1)>', display: '<b>', value: '<b>', error: false }, { label: '"&', display: "'", value: null, error: false });
  assert.doesNotMatch(evil, /<img|<b>/);
  assert.match(evil, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(evil, /&quot;&amp;: &#39;/);

  assert.match(render({ placeholder: false, kpis: [] }, {}), /Keine Kennzahlen eingetragen/);
  for (const sample of [loading, placeholder, html, wrapped, evil]) assert.doesNotMatch(sample, /undefined|NaN|null/);
});

test('demo data has the same shape as real data', async () => {
  assert.deepEqual(dc.demo(), {
    placeholder: true,
    kpis: [
      { label: '[Kennzahl 1]', display: '–', value: null, error: false },
      { label: '[Kennzahl 2]', display: '–', value: null, error: false },
    ],
  });
  // value is a number, text, yes/no, ISO time or null depending on the mode
  const shape = (value) =>
    Array.isArray(value)
      ? [...new Set(value.map((item) => JSON.stringify(shape(item))))].map((s) => JSON.parse(s))
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, key === 'value' ? 'any' : shape(value[key])]))
        : typeof value;
  const realShape = shape(await dc.fetch(stub().ctx));
  const demoShape = shape(dc.demo());
  assert.deepEqual(demoShape, realShape);
  assert.deepEqual(realShape.kpis, [{ display: 'string', error: 'boolean', label: 'string', value: 'any' }]);
});
