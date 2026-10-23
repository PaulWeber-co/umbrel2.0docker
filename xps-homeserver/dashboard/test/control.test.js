import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createControl,
  DEFAULT_CONTROL,
  hostStateFor,
  instantAfter,
  isScheduledOn,
  loadControl,
  nextFlip,
  normalizeControl,
  onBatteryFrom,
  presenceFrom,
  resolve,
} from '../server/control.js';

const TZ = 'Europe/Berlin';
const quiet = { warn() {}, log() {}, error() {} };
// Wednesday 2026-10-21 and Saturday 2026-10-24, wall-clock time in Berlin (UTC+2)
const wed = (clock) => Date.parse(`2026-10-21T${clock}:00+02:00`);
const sat = (clock) => Date.parse(`2026-10-24T${clock}:00+02:00`);
const base = normalizeControl({});
const inputs = (now, extra = {}) => ({ now, timeZone: TZ, musicActive: false, roomDark: false, present: null, onBattery: false, wakeUntil: 0, ...extra });
const withSettings = (changes) => normalizeControl(changes, base);

test('normalizeControl fills defaults, keeps unknown-free settings and rejects typos', () => {
  assert.deepEqual(normalizeControl({}), { ...DEFAULT_CONTROL, schedule: DEFAULT_CONTROL.schedule, override: null });
  const changed = normalizeControl({ mode: 'off', features: { brightness: 40 }, schedule: { weekend: { off: '00:30' } } }, base);
  assert.equal(changed.mode, 'off');
  assert.equal(changed.features.brightness, 40);
  assert.equal(changed.features.airplay, true, 'fields that were not sent keep their value');
  assert.deepEqual(changed.schedule.weekend, { on: '07:00', off: '00:30' });

  for (const bad of [
    { mode: 'sometimes' },
    { outside: 'dim' },
    { schedule: { weekdays: { on: '6:00' } } },
    { schedule: { weekdays: { off: '24:00' } } },
    { rules: { touchWake: 7 } },
    { rules: { darkRoom: 'yes' } },
    { rules: { presenceEntity: 'light.wohnzimmer' } },
    { features: { brightness: 2 } },
    { features: { brightness: 50.5 } },
    { features: 'all' },
    null,
    [],
  ]) {
    assert.throws(() => normalizeControl(bad, base), (error) => error.status === 400, JSON.stringify(bad));
  }
  assert.equal(normalizeControl({ rules: { presenceEntity: ' Person.Paul ' } }).rules.presenceEntity, 'person.paul');
});

test('a broken control.json falls back to the defaults', () => {
  assert.deepEqual(loadControl({ mode: 'kaputt' }, quiet), normalizeControl({}));
  assert.deepEqual(loadControl(null, quiet), normalizeControl({}));
  assert.equal(loadControl({ override: { state: 'off' } }, quiet).override, null, 'an override without an end is dropped');
});

test('the schedule knows weekdays, weekends and periods past midnight', () => {
  const schedule = { weekdays: { on: '06:00', off: '22:30' }, weekend: { on: '08:00', off: '00:30' } };
  assert.equal(isScheduledOn(schedule, 3, 5 * 60 + 59), false);
  assert.equal(isScheduledOn(schedule, 3, 6 * 60), true);
  assert.equal(isScheduledOn(schedule, 3, 22 * 60 + 29), true);
  assert.equal(isScheduledOn(schedule, 3, 22 * 60 + 30), false);
  // Friday night uses the weekday times, Saturday night runs until 00:30 on Sunday
  assert.equal(isScheduledOn(schedule, 6, 15), false, 'Sat 00:15 belongs to Friday, which ended 22:30');
  assert.equal(isScheduledOn(schedule, 6, 23 * 60), true);
  assert.equal(isScheduledOn(schedule, 7, 15), true, 'Sun 00:15 still belongs to Saturday');
  assert.equal(isScheduledOn(schedule, 1, 15), true, 'Mon 00:15 still belongs to Sunday');
  assert.equal(isScheduledOn(schedule, 1, 45), false);
  // on equal to off: on around the clock
  assert.equal(isScheduledOn({ weekdays: { on: '00:00', off: '00:00' }, weekend: schedule.weekend }, 2, 3 * 60), true);
});

test('nextFlip finds the next switch, also over the weekend', () => {
  const schedule = DEFAULT_CONTROL.schedule;
  assert.deepEqual(nextFlip(schedule, 3, 12 * 60), { inMinutes: 10 * 60 + 30, on: false, weekday: 3, at: '22:30' });
  assert.deepEqual(nextFlip(schedule, 3, 23 * 60), { inMinutes: 7 * 60, on: true, weekday: 4, at: '06:00' });
  // Friday 23:00 → Saturday 07:00 (weekend time)
  assert.deepEqual(nextFlip(schedule, 5, 23 * 60), { inMinutes: 8 * 60, on: true, weekday: 6, at: '07:00' });
  // The next switch on, skipping the coming switch off
  assert.deepEqual(nextFlip(schedule, 3, 12 * 60, { wantOn: true }), { inMinutes: 18 * 60, on: true, weekday: 4, at: '06:00' });
  const always = { weekdays: { on: '05:00', off: '05:00' }, weekend: { on: '05:00', off: '05:00' } };
  assert.equal(nextFlip(always, 3, 12 * 60), null);
});

test('instantAfter lands on the wall-clock time across a DST change', () => {
  // Saturday 2026-10-24 23:00 CEST; clocks go back on Sunday at 03:00 → 02:00
  const now = Date.parse('2026-10-24T23:00:00+02:00');
  assert.equal(new Date(instantAfter(now, 8 * 60, '07:00', TZ)).toISOString(), '2026-10-25T06:00:00.000Z', '07:00 CET');
  // Saturday 2026-03-28 23:00 CET; clocks go forward on Sunday 02:00 → 03:00
  const spring = Date.parse('2026-03-28T23:00:00+01:00');
  assert.equal(new Date(instantAfter(spring, 8 * 60, '07:00', TZ)).toISOString(), '2026-03-29T05:00:00.000Z', '07:00 CEST');
});

test('automatic mode follows the schedule, the dark room and the next switch', () => {
  const day = resolve(base, inputs(wed('12:00')));
  assert.equal(day.display, 'on');
  assert.equal(day.reason, 'Zeitplan');
  assert.equal(day.until, wed('22:30'));
  assert.deepEqual(day.next, { display: 'night', at: wed('22:30') });

  const dark = resolve(base, inputs(wed('12:00'), { roomDark: true }));
  assert.equal(dark.display, 'night');
  assert.equal(dark.reason, 'Raum ist dunkel');
  assert.equal(resolve(withSettings({ rules: { darkRoom: false } }), inputs(wed('12:00'), { roomDark: true })).display, 'on');

  const night = resolve(base, inputs(wed('23:15')));
  assert.equal(night.display, 'night');
  assert.equal(night.reason, 'Nachtruhe');
  assert.equal(night.until, Date.parse('2026-10-22T06:00:00+02:00'));
  assert.equal(resolve(withSettings({ outside: 'off' }), inputs(wed('23:15'))).display, 'off');
  assert.equal(resolve(withSettings({ outside: 'sleep' }), inputs(wed('23:15'))).display, 'sleep');
  // Saturday 06:30 is still night with the weekend's 07:00
  assert.equal(resolve(base, inputs(sat('06:30'))).display, 'night');
});

test('music, a tap and presence come before the schedule', () => {
  const late = wed('23:15');
  assert.equal(resolve(base, inputs(late, { musicActive: true })).reason, 'Musik läuft');
  assert.equal(resolve(withSettings({ rules: { musicWakes: false } }), inputs(late, { musicActive: true })).display, 'night');
  assert.equal(resolve(withSettings({ features: { musicMode: false } }), inputs(late, { musicActive: true })).display, 'night');

  const tapped = resolve(base, inputs(late, { wakeUntil: late + 60_000 }));
  assert.equal(tapped.display, 'on');
  assert.equal(tapped.until, late + 60_000);
  assert.equal(resolve(base, inputs(late, { wakeUntil: late - 1 })).display, 'night', 'an expired tap counts no more');

  const watched = withSettings({ rules: { presenceEntity: 'person.paul', presenceAway: 'off' } });
  assert.equal(resolve(watched, inputs(wed('12:00'), { present: false })).display, 'off');
  assert.equal(resolve(watched, inputs(wed('12:00'), { present: false })).reason, 'Niemand zu Hause');
  assert.equal(resolve(watched, inputs(wed('12:00'), { present: null })).display, 'on', 'unknown presence changes nothing');
  assert.equal(resolve(watched, inputs(wed('12:00'), { present: false, musicActive: true })).display, 'on', 'music means someone is home');
  assert.equal(resolve(base, inputs(wed('12:00'), { present: false })).display, 'on', 'without an entity presence is ignored');
});

test('overrides, battery saver and the fixed modes win over automatic', () => {
  const now = wed('12:00');
  const override = withSettings({ override: { state: 'off', until: now + 3_600_000 } });
  assert.deepEqual(
    { display: resolve(override, inputs(now)).display, source: resolve(override, inputs(now)).source },
    { display: 'off', source: 'override' },
  );
  assert.equal(resolve(override, inputs(now + 3_600_000)).display, 'on', 'an override ends on time');

  const battery = resolve(base, inputs(now, { onBattery: true }));
  assert.equal(battery.display, 'off');
  assert.equal(battery.source, 'battery');
  assert.equal(resolve(withSettings({ rules: { batterySaver: false } }), inputs(now, { onBattery: true })).display, 'on');

  const always = resolve(withSettings({ mode: 'on' }), inputs(wed('23:15'), { roomDark: true }));
  assert.equal(always.display, 'on');
  assert.equal(always.next, null);
  assert.equal(resolve(withSettings({ mode: 'off' }), inputs(now, { musicActive: true })).display, 'off');
  assert.equal(resolve(withSettings({ mode: 'off', override: { state: 'on', until: now + 60_000 } }), inputs(now)).display, 'on');
});

test('hostStateFor turns the decision into what the host applies', () => {
  const on = { display: 'on' };
  assert.deepEqual(hostStateFor(base, on), { version: 1, display: 'on', kiosk: true, backlight: 'auto', camera: true, airplay: true });
  const fixed = withSettings({ features: { autoBrightness: false, brightness: 80 }, rules: { darkRoom: false } });
  assert.equal(hostStateFor(fixed, on).backlight, 80);
  assert.equal(hostStateFor(fixed, on).camera, false, 'no reading needed: no webcam');
  assert.equal(hostStateFor(fixed, { display: 'night' }).backlight, 25, 'the night clock never glares');
  assert.deepEqual(hostStateFor(base, { display: 'sleep' }), { version: 1, display: 'sleep', kiosk: true, backlight: 'off', camera: false, airplay: true });
  assert.deepEqual(hostStateFor(withSettings({ features: { airplay: false } }), { display: 'off' }), {
    version: 1,
    display: 'off',
    kiosk: false,
    backlight: 'off',
    camera: false,
    airplay: false,
  });
});

test('presence and power readings', () => {
  assert.equal(presenceFrom('person.paul', 'home'), true);
  assert.equal(presenceFrom('person.paul', 'not_home'), false);
  assert.equal(presenceFrom('person.paul', 'Arbeit'), false);
  assert.equal(presenceFrom('person.paul', 'unavailable'), null);
  assert.equal(presenceFrom('zone.home', '2'), true);
  assert.equal(presenceFrom('zone.home', '0'), false);
  assert.equal(presenceFrom('group.familie', 'home'), true);
  assert.equal(presenceFrom('binary_sensor.jemand_da', 'off'), false);

  const ac = (online) => ({ name: 'AC', type: 'Mains', online, status: null });
  const bat = (status) => ({ name: 'BAT0', type: 'Battery', online: null, status });
  assert.equal(onBatteryFrom([ac('1'), bat('Not charging')]), false);
  assert.equal(onBatteryFrom([ac('0'), bat('Discharging')]), true);
  assert.equal(onBatteryFrom([ac('0'), { name: 'ucsi', type: 'USB', online: '1' }, bat('Charging')]), false, 'USB-C charger');
  assert.equal(onBatteryFrom([bat('Discharging')]), true);
  assert.equal(onBatteryFrom([]), null);
});

function fakeHub(entries = {}) {
  const listeners = new Set();
  return {
    ctx: { fetchJson: async () => ({ state: 'not_home' }) },
    snapshot: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(entry) {
      for (const listener of listeners) listener(entry);
    },
  };
}

function memoryStore(files = {}) {
  return {
    files,
    read: async (name, fallback) => (name in files ? structuredClone(files[name]) : fallback),
    write: async (name, value) => {
      files[name] = structuredClone(value);
    },
  };
}

const config = (values = {}) => ({ timezone: TZ, demo: false, get: (key, fallback = '') => values[key] ?? fallback });

test('the running control center writes host-state.json and reacts to music, taps and overrides', async () => {
  let clock = wed('23:15');
  const store = memoryStore();
  const hub = fakeHub({ music: { id: 'music', data: { active: false } } });
  const control = createControl({ store, config: config(), hub, log: quiet, now: () => clock, readPower: async () => [], statusFile: '/nonexistent' });
  const seen = [];
  control.subscribe((snapshot) => seen.push(snapshot.effective.display));
  await control.start();
  try {
    assert.equal(store.files['host-state.json'].display, 'night');
    assert.equal(store.files['host-state.json'].kiosk, true);

    hub.emit({ id: 'music', data: { active: true } });
    await control.refresh();
    assert.equal(control.snapshot().effective.display, 'on');
    hub.emit({ id: 'music', data: { active: false } });
    await control.refresh();

    await control.wake();
    assert.equal(control.snapshot().effective.reason, 'Angetippt');
    clock += 6 * 60_000;
    await control.refresh();
    assert.equal(control.snapshot().effective.display, 'night', 'five minutes later the night clock is back');

    await control.override({ state: 'off', minutes: 60 });
    assert.equal(store.files['host-state.json'].kiosk, false);
    assert.equal(store.files['control.json'].override.until, clock + 3_600_000);
    // A tap does not wake a screen someone switched off; it ends "schwarz"
    await control.wake();
    assert.equal(control.snapshot().effective.display, 'off');
    await control.override({ state: 'sleep', minutes: 60 });
    await control.wake();
    assert.equal(control.snapshot().effective.display, 'on');
    assert.equal(store.files['control.json'].override, null);

    await control.override({ state: 'off', until: 'morning' });
    assert.equal(store.files['control.json'].override.until, Date.parse('2026-10-22T06:00:00+02:00'));
    await control.override({ clear: true });
    await assert.rejects(control.override({ state: 'off', minutes: 0 }), (error) => error.status === 400);
    await assert.rejects(control.override({ state: 'dim', minutes: 5 }), (error) => error.status === 400);

    await control.update({ mode: 'on', override: { state: 'off', until: clock + 1e9 } });
    assert.equal(control.snapshot().settings.override, null, 'overrides only come through override()');
    assert.equal(control.snapshot().effective.display, 'on');
    assert.ok(seen.includes('night') && seen.includes('on') && seen.includes('off'));
  } finally {
    control.stop();
  }
});

test('the battery saver waits for a second reading before switching off', async () => {
  const store = memoryStore();
  let supplies = [{ name: 'AC', type: 'Mains', online: '0' }];
  const control = createControl({ store, config: config(), hub: fakeHub(), log: quiet, now: () => wed('12:00'), readPower: async () => supplies, statusFile: '/nonexistent' });
  await control.start();
  try {
    assert.equal(control.snapshot().effective.display, 'on', 'one reading on battery is not enough');
    await control.refresh();
    assert.equal(control.snapshot().effective.display, 'off');
    supplies = [{ name: 'AC', type: 'Mains', online: '1' }];
    await control.refresh();
    assert.equal(control.snapshot().effective.display, 'on');
  } finally {
    control.stop();
  }
});

test('presence comes from Home Assistant when an entity is set', async () => {
  const store = memoryStore({ 'control.json': { rules: { presenceEntity: 'person.paul' } } });
  const hub = fakeHub();
  const requests = [];
  hub.ctx.fetchJson = async (url, options) => {
    requests.push({ url, auth: options.headers.authorization });
    return { entity_id: 'person.paul', state: 'not_home' };
  };
  const control = createControl({
    store,
    config: config({ DASH_HA_URL: 'http://umbrel.local:8123', DASH_HA_TOKEN: 'secret' }),
    hub,
    log: quiet,
    now: () => wed('12:00'),
    readPower: async () => [],
    statusFile: '/nonexistent',
  });
  await control.start();
  try {
    assert.equal(requests[0].url, 'http://umbrel.local:8123/api/states/person.paul');
    assert.equal(requests[0].auth, 'Bearer secret');
    assert.equal(control.snapshot().effective.display, 'sleep');
    assert.equal(control.snapshot().inputs.present, false);
  } finally {
    control.stop();
  }
});
