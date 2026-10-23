// Control center ("Steuerung"): what the wall display shows and which parts
// of the XPS run. The settings are kept in control.json; every 15 seconds,
// and at once on every change that matters, resolve() turns them plus the
// live inputs into one display state:
//
//   on      the dashboard
//   night   only the dimmed clock (the "nacht" scene)
//   sleep   black, the backlight off; a tap wakes it (kiosk keeps running)
//   off     the kiosk browser stopped, panel off: the XPS is only a server
//
// The decision goes, together with the feature switches, into
// host-state.json in the data directory. scripts/xps-control.py (root) reads
// that file and applies it: kiosk and AirPlay on or off, the backlight, and
// the webcam sensor. The dashboard itself never gets root.
//
// Priority, highest first:
//   1. a temporary override from the quick actions ("1 Std. aus")
//   2. battery saver: running on the battery (power cut) → off
//   3. the mode "Immer an" / "Aus (nur Server)"
//   4. automatic: tapped the screen → on for a few minutes; AirPlay plays →
//      on; nobody at home (Home Assistant) → sleep or off; outside the
//      schedule → night clock, black or off; dark room → night clock; else on
//
// resolve(), normalizeControl() and the schedule helpers are pure and tested
// in test/control.test.js; createControl() wires them to the hub and files.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { haConfigured, haRequest } from './widgets/home-assistant.js';
import { hhmm, zoned } from './widgets/commute.js';

export const DISPLAY_STATES = ['on', 'night', 'sleep', 'off'];
export const MODES = ['auto', 'on', 'off'];
export const OUTSIDE = ['night', 'sleep', 'off'];
export const AWAY = ['sleep', 'off'];
export const TOUCH_WAKE_MINUTES = [0, 1, 2, 5, 10, 15, 30];
export const NIGHT_MAX_BRIGHTNESS = 25; // fixed brightness never glares at night

export const DEFAULT_CONTROL = Object.freeze({
  mode: 'auto',
  schedule: {
    weekdays: { on: '06:00', off: '22:30' },
    weekend: { on: '07:00', off: '23:30' },
  },
  outside: 'night',
  rules: {
    darkRoom: true,
    musicWakes: true,
    touchWake: 5,
    batterySaver: true,
    presenceEntity: '',
    presenceAway: 'sleep',
  },
  features: {
    autoBrightness: true,
    brightness: 70,
    airplay: true,
    musicMode: true,
    videos: true,
  },
  override: null,
});

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ENTITY = /^(person|device_tracker|group|binary_sensor|input_boolean|zone)\.[a-z0-9_]+$/;
const MAX_OVERRIDE_MINUTES = 24 * 60;

export const clockMinutes = (text) => {
  const match = CLOCK.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// Settings from a request or from control.json → complete, valid settings.
// Every field is optional and falls back to the current value (base); a field
// with a wrong value is an error, so a typo never silently resets something.
export function normalizeControl(input, base = DEFAULT_CONTROL) {
  if (!isObject(input)) throw badRequest('Einstellungen müssen ein JSON-Objekt sein');
  const pick = (value, allowed, name, fallback) => {
    if (value === undefined) return fallback;
    if (!allowed.includes(value)) throw badRequest(`${name}: ungültiger Wert ${JSON.stringify(value)}`);
    return value;
  };
  const flag = (value, name, fallback) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw badRequest(`${name} muss true oder false sein`);
    return value;
  };
  const clock = (value, name, fallback) => {
    if (value === undefined) return fallback;
    if (clockMinutes(value) === null) throw badRequest(`${name} muss eine Uhrzeit HH:MM sein`);
    return value;
  };
  const section = (value, name) => {
    if (value === undefined) return {};
    if (!isObject(value)) throw badRequest(`${name} muss ein Objekt sein`);
    return value;
  };

  const schedule = section(input.schedule, 'schedule');
  const rules = section(input.rules, 'rules');
  const features = section(input.features, 'features');
  const period = (name) => {
    const value = section(schedule[name], `schedule.${name}`);
    return {
      on: clock(value.on, `schedule.${name}.on`, base.schedule[name].on),
      off: clock(value.off, `schedule.${name}.off`, base.schedule[name].off),
    };
  };

  let brightness = base.features.brightness;
  if (features.brightness !== undefined) {
    if (!Number.isInteger(features.brightness) || features.brightness < 5 || features.brightness > 100) {
      throw badRequest('features.brightness muss eine ganze Zahl von 5 bis 100 sein');
    }
    brightness = features.brightness;
  }
  let presenceEntity = base.rules.presenceEntity;
  if (rules.presenceEntity !== undefined) {
    const text = typeof rules.presenceEntity === 'string' ? rules.presenceEntity.trim().toLowerCase() : null;
    if (text === null || (text && !ENTITY.test(text))) {
      throw badRequest('rules.presenceEntity: erwartet z. B. person.paul, group.familie oder zone.home');
    }
    presenceEntity = text;
  }

  return {
    mode: pick(input.mode, MODES, 'mode', base.mode),
    schedule: { weekdays: period('weekdays'), weekend: period('weekend') },
    outside: pick(input.outside, OUTSIDE, 'outside', base.outside),
    rules: {
      darkRoom: flag(rules.darkRoom, 'rules.darkRoom', base.rules.darkRoom),
      musicWakes: flag(rules.musicWakes, 'rules.musicWakes', base.rules.musicWakes),
      touchWake: pick(rules.touchWake, TOUCH_WAKE_MINUTES, 'rules.touchWake', base.rules.touchWake),
      batterySaver: flag(rules.batterySaver, 'rules.batterySaver', base.rules.batterySaver),
      presenceEntity,
      presenceAway: pick(rules.presenceAway, AWAY, 'rules.presenceAway', base.rules.presenceAway),
    },
    features: {
      autoBrightness: flag(features.autoBrightness, 'features.autoBrightness', base.features.autoBrightness),
      brightness,
      airplay: flag(features.airplay, 'features.airplay', base.features.airplay),
      musicMode: flag(features.musicMode, 'features.musicMode', base.features.musicMode),
      videos: flag(features.videos, 'features.videos', base.features.videos),
    },
    override: normalizeOverride(input.override === undefined ? base.override : input.override),
  };
}

// A stored override, or null when there is none or it is malformed.
function normalizeOverride(value) {
  if (!isObject(value)) return null;
  if (!DISPLAY_STATES.includes(value.state) || !Number.isFinite(value.until)) return null;
  return { state: value.state, until: value.until };
}

// The saved file → settings; a broken or outdated file never stops the dashboard.
export function loadControl(saved, log = console) {
  if (!saved) return normalizeControl({});
  try {
    return normalizeControl(saved);
  } catch (error) {
    log.warn(`[control] control.json: ${error.message}, nehme die Standardwerte`);
    return normalizeControl({});
  }
}

/* ---------- schedule ---------- */

// Mon–Fri use the weekday times, Sat and Sun the weekend times. A period may
// run past midnight (on 08:00, off 00:30): those minutes belong to the day it
// started. on equal to off means on all day.
const periodFor = (schedule, weekday) => (weekday >= 6 ? schedule.weekend : schedule.weekdays);
const previousDay = (weekday) => (weekday === 1 ? 7 : weekday - 1);

export function isScheduledOn(schedule, weekday, minutes) {
  const today = periodFor(schedule, weekday);
  const on = clockMinutes(today.on);
  const off = clockMinutes(today.off);
  if (on === off) return true;
  if (on < off ? minutes >= on && minutes < off : minutes >= on) return true;
  const yesterday = periodFor(schedule, previousDay(weekday));
  const yOn = clockMinutes(yesterday.on);
  const yOff = clockMinutes(yesterday.off);
  return yOn > yOff && minutes < yOff;
}

// The next moment the schedule switches, from weekday/minutes in wall-clock
// time: { inMinutes, on (state after the switch), weekday, at: "HH:MM" }, or
// null when it never switches (on all day, every day).
export function nextFlip(schedule, weekday, minutes, { wantOn } = {}) {
  let state = isScheduledOn(schedule, weekday, minutes);
  for (let ahead = 0; ahead <= 8; ahead++) {
    const day = ((weekday - 1 + ahead) % 7) + 1;
    const marks = new Set([0]);
    for (const period of [periodFor(schedule, day), periodFor(schedule, previousDay(day))]) {
      marks.add(clockMinutes(period.on));
      marks.add(clockMinutes(period.off));
    }
    for (const mark of [...marks].sort((a, b) => a - b)) {
      const inMinutes = ahead * 1440 + mark - minutes;
      if (inMinutes <= 0) continue;
      const after = isScheduledOn(schedule, day, mark);
      if (after === state) continue;
      state = after;
      if (wantOn === undefined || after === wantOn) return { inMinutes, on: after, weekday: day, at: hhmm(mark) };
    }
  }
  return null;
}

// Wall-clock minutes ahead → an instant. A DST change in between moves the
// wall clock by an hour; the result is corrected so it lands on `at`.
export function instantAfter(nowMs, inMinutes, at, timeZone) {
  let until = nowMs + inMinutes * 60_000;
  const target = clockMinutes(at);
  if (target !== null && timeZone) {
    // -720 … 719: 23:30 against 00:30 is one hour, not 23
    const drift = ((((zoned(new Date(until), timeZone).minutes - target + 720) % 1440) + 1440) % 1440) - 720;
    if (Math.abs(drift) <= 120) until -= drift * 60_000;
  }
  return Math.floor(until / 60_000) * 60_000;
}

/* ---------- the decision ---------- */

const REASONS = {
  override: { on: 'Manuell an', night: 'Manuell: Nachtuhr', sleep: 'Manuell schwarz', off: 'Manuell aus' },
  outside: { night: 'Nachtruhe', sleep: 'Nachtruhe', off: 'Nachtruhe' },
};

// inputs: { now (ms), timeZone, musicActive, roomDark, present (true/false/
// null = unknown), onBattery, wakeUntil (ms) }
// → { display, source, reason, until (ms | null), next ({ display, at } | null) }
export function resolve(control, inputs) {
  const { now, timeZone } = inputs;
  const { weekday, minutes } = zoned(new Date(now), timeZone);
  const scheduled = isScheduledOn(control.schedule, weekday, minutes);
  const flip = control.mode === 'auto' ? nextFlip(control.schedule, weekday, minutes) : null;
  const flipAt = flip ? instantAfter(now, flip.inMinutes, flip.at, timeZone) : null;
  const next = flip ? { display: flip.on ? 'on' : control.outside, at: flipAt } : null;
  const result = (display, source, reason, until = null) => ({ display, source, reason, until, next });

  if (control.override && control.override.until > now) {
    return result(control.override.state, 'override', REASONS.override[control.override.state], control.override.until);
  }
  if (control.rules.batterySaver && inputs.onBattery) return result('off', 'battery', 'Akkubetrieb – Strom weg?');
  if (control.mode === 'on') return { ...result('on', 'mode', 'Immer an'), next: null };
  if (control.mode === 'off') return { ...result('off', 'mode', 'Aus – nur Server'), next: null };

  if (control.rules.touchWake && inputs.wakeUntil > now) return result('on', 'touch', 'Angetippt', inputs.wakeUntil);
  if (control.features.musicMode && control.rules.musicWakes && inputs.musicActive) return result('on', 'music', 'Musik läuft');
  if (control.rules.presenceEntity && inputs.present === false) {
    return result(control.rules.presenceAway, 'presence', 'Niemand zu Hause');
  }
  if (!scheduled) return result(control.outside, 'schedule', REASONS.outside[control.outside], flipAt);
  if (control.rules.darkRoom && inputs.roomDark) return result('night', 'dark', 'Raum ist dunkel');
  return result('on', 'schedule', 'Zeitplan', flipAt);
}

// What scripts/xps-control.py applies on the host.
export function hostStateFor(control, decision) {
  const { display } = decision;
  const visible = display === 'on' || display === 'night';
  const { features } = control;
  let backlight = 'off';
  if (visible) {
    if (features.autoBrightness) backlight = 'auto';
    else backlight = display === 'night' ? Math.min(features.brightness, NIGHT_MAX_BRIGHTNESS) : features.brightness;
  }
  return {
    version: 1,
    display,
    kiosk: display !== 'off',
    backlight,
    // The webcam only runs while its reading changes something on screen
    camera: visible && (features.autoBrightness || (control.mode === 'auto' && control.rules.darkRoom)),
    airplay: features.airplay,
  };
}

/* ---------- presence and power ---------- */

// A Home Assistant state → true (someone home), false (nobody) or null.
export function presenceFrom(entityId, state) {
  const value = String(state ?? '').trim().toLowerCase();
  if (!value || value === 'unknown' || value === 'unavailable') return null;
  const domain = entityId.slice(0, entityId.indexOf('.'));
  if (domain === 'zone') return Number.isFinite(Number(value)) ? Number(value) > 0 : null;
  if (domain === 'binary_sensor' || domain === 'input_boolean') return value === 'on' ? true : value === 'off' ? false : null;
  if (value === 'home' || value === 'on') return true;
  if (value === 'not_home' || value === 'off') return false;
  // person / device_tracker in another zone ("Arbeit") are away
  return domain === 'person' || domain === 'device_tracker' ? false : null;
}

// Power supplies from /sys/class/power_supply → true on battery, false on the
// charger, null when the machine has neither (a desktop, the Mac).
export function onBatteryFrom(supplies) {
  const mains = supplies.filter((s) => s.type === 'Mains' || s.type === 'USB' || s.type === 'USB_C');
  if (mains.some((s) => s.online === '1')) return false;
  if (supplies.some((s) => s.type === 'Mains')) return true;
  const batteries = supplies.filter((s) => s.type === 'Battery');
  if (!batteries.length) return null;
  return batteries.some((s) => s.status === 'Discharging');
}

export async function readPowerSupplies(dir = '/sys/class/power_supply') {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const read = (name, file) => readFile(join(dir, name, file), 'utf8').then((text) => text.trim(), () => null);
  return Promise.all(
    names.map(async (name) => ({ name, type: await read(name, 'type'), online: await read(name, 'online'), status: await read(name, 'status') })),
  );
}

/* ---------- the running control center ---------- */

const TICK_MS = 15_000;
const PRESENCE_MS = 60_000;
const BATTERY_CONFIRM = 2; // readings in a row before the battery saver acts

export function createControl({
  store,
  config,
  hub,
  log = console,
  now = () => Date.now(),
  readPower = readPowerSupplies,
  statusFile = config.get?.('DASH_CONTROL_STATUS_FILE', '/run/xps-control/status.json') ?? '/run/xps-control/status.json',
}) {
  let settings = normalizeControl({});
  let wakeUntil = 0;
  let present = null;
  let presenceError = null;
  let batteryReadings = 0;
  let onBattery = null;
  let hostStatus = null;
  let decision = null;
  let host = null;
  let lastHostJson = null;
  let lastSnapshotJson = null;
  const timers = [];
  const listeners = new Set();
  const inputs = { musicActive: false, roomDark: false };
  let unsubscribe = () => {};
  let ticking = Promise.resolve();

  const fromHub = (entry) => {
    if (entry?.id === 'music') inputs.musicActive = Boolean(entry.data?.active);
    else if (entry?.id === 'ambient') inputs.roomDark = Boolean(entry.data?.available && entry.data.dark);
    else return false;
    return true;
  };

  async function readHostStatus() {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      return isObject(status) ? status : null;
    } catch {
      return null;
    }
  }

  async function readBattery() {
    const reading = onBatteryFrom(await readPower());
    if (reading === null) return null;
    batteryReadings = reading ? batteryReadings + 1 : 0;
    return batteryReadings >= BATTERY_CONFIRM;
  }

  async function pollPresence() {
    const entity = settings.rules.presenceEntity;
    if (!entity || config.demo || !haConfigured(config)) {
      present = null;
      presenceError = entity && !config.demo && !haConfigured(config) ? 'Home Assistant ist nicht eingerichtet (DASH_HA_URL, DASH_HA_TOKEN)' : null;
      return;
    }
    try {
      const state = await haRequest({ config, fetchJson: hub.ctx.fetchJson }, `/api/states/${encodeURIComponent(entity)}`);
      present = presenceFrom(entity, state?.state);
      presenceError = present === null ? `${entity} meldet „${state?.state ?? '?'}“` : null;
    } catch (error) {
      present = null;
      presenceError = String(error.message ?? error).split(config.get('DASH_HA_TOKEN') || '\0').join('…');
    }
  }

  function snapshot() {
    return {
      timezone: config.timezone,
      settings,
      effective: decision,
      host,
      status: hostStatus,
      inputs: { ...inputs, present, presenceError, onBattery, wakeUntil: wakeUntil > now() ? wakeUntil : null },
    };
  }

  async function evaluate({ readHardware = false } = {}) {
    if (settings.override && settings.override.until <= now()) {
      settings = { ...settings, override: null };
      await store.write('control.json', settings);
    }
    if (readHardware) {
      onBattery = await readBattery();
      hostStatus = await readHostStatus();
    }
    decision = resolve(settings, { now: now(), timeZone: config.timezone, ...inputs, present, onBattery, wakeUntil });
    host = hostStateFor(settings, decision);
    const hostJson = JSON.stringify(host);
    if (hostJson !== lastHostJson) {
      await store.write('host-state.json', { ...host, writtenAt: now() });
      lastHostJson = hostJson;
    }
    const current = snapshot();
    const json = JSON.stringify(current);
    if (json !== lastSnapshotJson) {
      lastSnapshotJson = json;
      for (const listener of listeners) listener(current);
    }
    return current;
  }

  // One evaluation at a time, in order; an error is logged, never thrown at a timer
  const tick = (options) => {
    ticking = ticking.then(() => evaluate(options)).catch((error) => log.error(`[control] ${error.message}`));
    return ticking;
  };
  // An override or a tap ends on time, not up to 15 s late
  const later = (ms) => {
    if (!(ms > 0) || ms > 2 ** 31 - 1) return;
    const timer = setTimeout(() => tick(), ms + 250);
    timer.unref?.();
  };

  return {
    async start() {
      settings = loadControl(await store.read('control.json', null), log);
      if (settings.override) later(settings.override.until - now());
      for (const entry of Object.values(hub.snapshot())) fromHub(entry);
      unsubscribe = hub.subscribe((entry) => {
        if (fromHub(entry)) tick();
      });
      await pollPresence();
      await tick({ readHardware: true });
      timers.push(setInterval(() => tick({ readHardware: true }), TICK_MS));
      timers.push(setInterval(() => pollPresence().then(() => tick()), PRESENCE_MS));
      for (const timer of timers) timer.unref?.();
    },
    stop() {
      unsubscribe();
      for (const timer of timers.splice(0)) clearInterval(timer);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    // Changes from the panel: only the fields present in input change
    async update(input) {
      const { override, ...rest } = isObject(input) ? input : {};
      const next = normalizeControl(rest, settings);
      const presenceChanged = next.rules.presenceEntity !== settings.rules.presenceEntity;
      settings = next;
      await store.write('control.json', settings);
      if (presenceChanged) await pollPresence();
      await tick();
      return snapshot();
    },
    // { state, minutes } for that long, { state, until: 'morning' } until the
    // schedule switches on again, { clear: true } back to normal
    async override(input) {
      if (!isObject(input)) throw badRequest('Erwartet { state, minutes } oder { clear: true }');
      if (input.clear === true) {
        settings = { ...settings, override: null };
      } else {
        if (!DISPLAY_STATES.includes(input.state)) throw badRequest(`state muss ${DISPLAY_STATES.join(', ')} sein`);
        let until;
        if (input.until === 'morning') {
          const { weekday, minutes } = zoned(new Date(now()), config.timezone);
          const flip = nextFlip(settings.schedule, weekday, minutes, { wantOn: true });
          until = flip ? instantAfter(now(), flip.inMinutes, flip.at, config.timezone) : now() + 12 * 3_600_000;
        } else if (Number.isInteger(input.minutes) && input.minutes >= 1 && input.minutes <= MAX_OVERRIDE_MINUTES) {
          until = now() + input.minutes * 60_000;
        } else {
          throw badRequest('minutes muss zwischen 1 und 1440 liegen, oder until: "morning"');
        }
        settings = { ...settings, override: { state: input.state, until } };
        wakeUntil = 0;
        later(until - now());
      }
      await store.write('control.json', settings);
      await tick();
      return snapshot();
    },
    // A tap on the dark kiosk screen: someone wants to see it. Ends a
    // "schwarz" or night-clock override and, in automatic mode, shows the
    // dashboard for rules.touchWake minutes. touchWake 0 switches taps off.
    async wake() {
      const minutes = settings.rules.touchWake;
      if (!minutes) return snapshot();
      const { override } = settings;
      if (override && override.until > now() && (override.state === 'sleep' || override.state === 'night')) {
        settings = { ...settings, override: null };
        await store.write('control.json', settings);
      }
      if (settings.mode === 'auto') {
        wakeUntil = now() + minutes * 60_000;
        later(minutes * 60_000);
      }
      await tick();
      return snapshot();
    },
    // For tests: run the periodic work now
    refresh: () => tick({ readHardware: true }),
    pollPresence,
  };
}
