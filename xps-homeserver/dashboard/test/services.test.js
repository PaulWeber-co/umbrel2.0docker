// Services tile: the helper's container list (scripts/xps-services.py) →
// one entry per project, and the tile's markup.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNames, prettyName, toService, toWidgetData } from '../server/widgets/services.js';
import { bytes, render, uptime } from '../web/js/widgets/dienste.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const MIB = 1024 ** 2;
const up = (service, extra = {}) => ({ scope: 'host', project: 'shop', service, state: 'running', cpuPercent: 1, memBytes: 100 * MIB, startedAt: '2026-10-16T10:00:00Z', ...extra });
const sample = (containers, extra = {}) => ({ capturedAt: NOW - 5000, intervalSeconds: 30, sources: { host: { ok: true }, umbrel: { ok: true } }, containers, ...extra });

test('a project with every container up is ok, with summed CPU and memory', () => {
  const service = toService('shop', [up('web'), up('api', { cpuPercent: 2.25, startedAt: '2026-10-16T11:00:00Z' })], new Map(), NOW);
  assert.equal(service.status, 'ok');
  assert.equal(service.name, 'Shop');
  assert.equal(service.cpuPercent, 3.3);
  assert.equal(service.memBytes, 200 * MIB);
  assert.equal(service.running, 2);
  assert.equal(service.total, 2);
  assert.equal(service.uptimeSeconds, 3600, 'since the most recent start');
  assert.equal(service.problem, null);
});

test('unhealthy, restarting or stopped parts are a problem; finished one-shot jobs are not', () => {
  const unhealthy = toService('shop', [up('web'), up('db', { health: 'unhealthy' })], new Map(), NOW);
  assert.equal(unhealthy.status, 'warn');
  assert.equal(unhealthy.problem, 'db: ungesund');

  const stopped = toService('shop', [up('web'), { service: 'api', state: 'exited', exitCode: 1, restartPolicy: 'always' }], new Map(), NOW);
  assert.equal(stopped.status, 'warn');
  assert.equal(stopped.problem, 'api: aus');
  assert.equal(stopped.total, 2);

  const migrated = toService('shop', [up('web'), { service: 'migrate', state: 'exited', exitCode: 0, restartPolicy: 'no' }], new Map(), NOW);
  assert.equal(migrated.status, 'ok');
  assert.equal(migrated.total, 1, 'the finished job does not count');

  const down = toService('shop', [{ service: 'web', state: 'exited', exitCode: 0, restartPolicy: 'unless-stopped' }], new Map(), NOW);
  assert.equal(down.status, 'down');
  assert.equal(down.cpuPercent, null);
  assert.equal(down.uptimeSeconds, null);
});

test('projects are grouped, hidden ones left out, problems first, then by CPU', () => {
  const data = toWidgetData(
    sample([
      up('web'),
      { ...up('server', { cpuPercent: 9 }), scope: 'umbrel', project: 'immich' },
      { ...up('db', { health: 'unhealthy' }), project: 'blog' },
      { ...up('x'), project: 'secret' },
      { ...up('ha', { cpuPercent: 4 }), scope: 'umbrel', project: 'home-assistant' },
    ]),
    { hide: new Set(['secret']), names: parseNames('immich=Fotos'), now: NOW },
  );
  assert.deepEqual(data.services.map((s) => s.name), ['Blog', 'Fotos', 'Home Assistant', 'Shop']);
  assert.deepEqual(data.counts, { ok: 3, warn: 1, down: 0 });
  assert.equal(data.umbrelError, null);
});

test('stale data and a broken file are errors; an unreachable Umbrel is reported', () => {
  assert.throws(() => toWidgetData(sample([up('web')], { capturedAt: NOW - 3 * 60_000 }), { now: NOW }), /xps-services/);
  assert.throws(() => toWidgetData({ capturedAt: NOW }, { now: NOW }), /Format/);
  const data = toWidgetData(sample([up('web')], { sources: { host: { ok: true }, umbrel: { ok: false, error: 'No such container: umbrel' } } }), { now: NOW });
  assert.equal(data.umbrelError, 'No such container: umbrel');
});

test('names: settings, known projects and readable fallbacks', () => {
  assert.deepEqual([...parseNames('a=Eins, b = Zwei ,=x,c=')], [['a', 'Eins'], ['b', 'Zwei']]);
  assert.equal(prettyName('xps-airplay'), 'Lautsprecher', 'AirPlay and Spotify Connect');
  assert.equal(prettyName('shop-api_db'), 'Shop Api Db');
});

test('tile: summary, rows with figures or the problem, escaping', () => {
  const data = toWidgetData(sample([up('web'), { ...up('db', { health: 'unhealthy' }), project: '<b>x</b>' }]), { now: NOW });
  const html = render(data);
  assert.match(html, /1 mit Problem/);
  assert.match(html, /di-warn/);
  assert.match(html, /db: ungesund/);
  assert.match(html, /100 MB/);
  assert.match(html, /2 Std/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(render(toWidgetData(sample([up('web')]), { now: NOW })), /alle 1 laufen/);
  assert.match(render({ services: [], counts: {} }), /Noch keine Dienste/);
  assert.match(render(null), /Lädt/);
});

test('tile: more services than rows, and number formats', () => {
  const containers = ['a', 'b', 'c', 'd', 'e', 'f'].map((project) => ({ ...up('web'), project }));
  assert.match(render(toWidgetData(sample(containers), { now: NOW })), /\+ 2 weitere/);
  assert.equal(bytes(640 * MIB), '640 MB');
  assert.equal(bytes(1.5 * 1024 * MIB), '1,5 GB');
  assert.equal(bytes(null), '–');
  assert.equal(uptime(9 * 86_400 + 5), '9 T');
  assert.equal(uptime(5 * 3600), '5 Std');
  assert.equal(uptime(30), '1 Min');
});
