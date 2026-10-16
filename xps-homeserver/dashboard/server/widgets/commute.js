// Commute ("Arbeitsweg") on workday mornings with live traffic from TomTom
// (https://developer.tomtom.com): Routing API for the drive, Search API to turn
// the two addresses into coordinates once.
//
// Settings:
//   DASH_TOMTOM_KEY       API key (required)
//   DASH_HOME_ADDRESS     start as free text, or DASH_HOME_COORDS as "lat,lon"
//   DASH_WORK_ADDRESS     destination, or DASH_WORK_COORDS as "lat,lon"
//                         coordinates win and skip geocoding; each end needs one
//   DASH_COMMUTE_DAYS     ISO weekdays, Mon = 1: "1-5" (default), "1,3,5", "1-3,6"
//   DASH_COMMUTE_FROM     window start, local time in config.timezone, "06:00"
//   DASH_COMMUTE_TO       window end (exclusive), "09:30"
//   DASH_COMMUTE_LABEL    tile heading, "Ins Büro"
//
// Requests only go out inside the window, one route every 5 minutes: TomTom's
// free plan allows 2,500 requests a day, 06:00–09:30 uses about 42 per workday.
// Each address is geocoded once and cached in the store as geocode.json.
// The key has to travel in the query string (TomTom has no header auth for
// these APIs), so every error message is scrubbed of it before it leaves here.
import { redact } from '../hub.js';

const SEARCH = 'https://api.tomtom.com/search/2/geocode';
const ROUTING = 'https://api.tomtom.com/routing/1/calculateRoute';
const CACHE = 'geocode.json';

const DAY_NAMES = [null, 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ISO_DAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Weekday (Mon = 1) and wall-clock time of an instant in the given time zone,
// never in the zone of the machine the server runs on.
export function zoned(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return { weekday: ISO_DAYS[parts.weekday], minutes: hour * 60 + minute, clock: `${pad(hour)}:${pad(minute)}` };
}

const pad = (n) => String(n).padStart(2, '0');

// Minutes since midnight → "06:00" and the short form "6" / "9:30".
export const hhmm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export const shortClock = (minutes) => {
  const hour = Math.floor(minutes / 60);
  return minutes % 60 ? `${hour}:${pad(minutes % 60)}` : String(hour);
};

const invalid = (key, value, hint) => new Error(`${key} ist ungültig: "${value}" (erwartet ${hint})`);

// "1-5" → [1, 2, 3, 4, 5]; "1,3,5" and mixes like "1-3,6" work too.
export function parseDays(text) {
  const days = new Set();
  for (const part of String(text).split(',')) {
    const match = part.trim().match(/^([1-7])(?:\s*-\s*([1-7]))?$/);
    const first = Number(match?.[1]);
    const last = Number(match?.[2] ?? match?.[1]);
    if (!match || last < first) throw invalid('DASH_COMMUTE_DAYS', text, 'z. B. 1-5 oder 1,3,5');
    for (let day = first; day <= last; day++) days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

// "06:00" or "6:00" → 360
export function parseClock(text, key = 'Uhrzeit') {
  const match = String(text).trim().match(/^(\d{1,2}):(\d{2})$/);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) throw invalid(key, text, 'HH:MM');
  return hour * 60 + minute;
}

export function readWindow(config) {
  const window = {
    days: parseDays(config.get('DASH_COMMUTE_DAYS', '1-5')),
    from: parseClock(config.get('DASH_COMMUTE_FROM', '06:00'), 'DASH_COMMUTE_FROM'),
    to: parseClock(config.get('DASH_COMMUTE_TO', '09:30'), 'DASH_COMMUTE_TO'),
  };
  if (window.from >= window.to) throw new Error('DASH_COMMUTE_FROM muss vor DASH_COMMUTE_TO liegen');
  return window;
}

export function isActive(date, window, timeZone) {
  const { weekday, minutes } = zoned(date, timeZone);
  return window.days.includes(weekday) && minutes >= window.from && minutes < window.to;
}

// The next window start as "Mo 06:00": today's if it is still ahead, otherwise
// the next listed weekday's (a week ahead when only today is listed).
export function nextStart(date, window, timeZone) {
  const { weekday, minutes } = zoned(date, timeZone);
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = ((weekday - 1 + ahead) % 7) + 1;
    if (!window.days.includes(day) || (ahead === 0 && minutes >= window.from)) continue;
    return `${DAY_NAMES[day]} ${hhmm(window.from)}`;
  }
  return null;
}

// [1, 2, 3, 4, 5] → "Werktags", [1, 3, 5] → "Mo, Mi, Fr", [1, 2, 3, 4] → "Mo–Do"
export function describeDays(days) {
  if (days.join() === '1,2,3,4,5') return 'Werktags';
  if (days.length === 7) return 'Täglich';
  const runs = [];
  for (const day of days) {
    const run = runs.at(-1);
    if (run && day === run.at(-1) + 1) run.push(day);
    else runs.push([day]);
  }
  return runs
    .flatMap((run) => (run.length >= 3 ? [`${DAY_NAMES[run[0]]}–${DAY_NAMES[run.at(-1)]}`] : run.map((d) => DAY_NAMES[d])))
    .join(', ');
}

// { days: [1..5], from: 360, to: 570 } → "Werktags 6–9:30 Uhr"
export const describeWindow = ({ days, from, to }) => `${describeDays(days)} ${shortClock(from)}–${shortClock(to)} Uhr`;

// "53.5506,10.0009" → { lat, lon }, anything else → null
export function parseCoords(text) {
  const match = String(text ?? '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

const setting = (config, key) => String(config.get(key, '')).trim();
const ENDS = ['HOME', 'WORK'];

function endpoint(config, end) {
  const coords = setting(config, `DASH_${end}_COORDS`);
  if (coords) {
    const position = parseCoords(coords);
    if (!position) throw invalid(`DASH_${end}_COORDS`, coords, '"lat,lon", z. B. 53.5506,10.0009');
    return { position };
  }
  return { address: setting(config, `DASH_${end}_ADDRESS`) };
}

export const geocodeUrl = (address, key) =>
  `${SEARCH}/${encodeURIComponent(address)}.json?${new URLSearchParams({ key, limit: 1, countrySet: 'DE', language: 'de-DE' })}`;

export const routeUrl = (from, to, key) =>
  `${ROUTING}/${from.lat},${from.lon}:${to.lat},${to.lon}/json?${new URLSearchParams({
    key,
    traffic: 'true',
    travelMode: 'car',
    routeType: 'fastest',
    computeTravelTimeFor: 'all',
    language: 'de-DE',
  })}`;

const asPosition = (value) =>
  Number.isFinite(value?.lat) && Number.isFinite(value?.lon) ? { lat: value.lat, lon: value.lon } : null;

// The first geocoding hit's position, or null when TomTom found nothing.
export const toPosition = (json) => asPosition(json?.results?.[0]?.position);

// Removes the key from a message, also where it is not a ?key= parameter.
export function hideKey(message, key) {
  let text = redact(String(message));
  if (key) for (const form of new Set([key, encodeURIComponent(key)])) text = text.split(form).join('…');
  return text;
}

async function getJson(ctx, url, key) {
  try {
    return await ctx.fetchJson(url);
  } catch (error) {
    throw new Error(hideKey(error.message, key));
  }
}

// Start and destination: configured coordinates, cached positions or one
// geocoding request per new address.
async function positions(ctx, key) {
  const ends = ENDS.map((end) => endpoint(ctx.config, end));
  if (ends.every((end) => end.position)) return ends.map((end) => end.position);

  const stored = await ctx.store.read(CACHE, {});
  const cache = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  let changed = false;
  try {
    for (const end of ends) {
      if (end.position) continue;
      end.position = asPosition(cache[end.address]);
      if (end.position) continue;
      end.position = toPosition(await getJson(ctx, geocodeUrl(end.address, key), key));
      if (!end.position) throw new Error(`Adresse nicht gefunden: ${end.address}`);
      cache[end.address] = end.position;
      changed = true;
    }
  } finally {
    // keep what was found even when the other address failed
    if (changed) await ctx.store.write(CACHE, cache);
  }
  return ends.map((end) => end.position);
}

// Delay in whole minutes → 'frei' (< 3), 'zäh' (< 10) or 'stau'
export const levelFor = (delayMinutes) => (delayMinutes < 3 ? 'frei' : delayMinutes < 10 ? 'zäh' : 'stau');

const minutesOf = (seconds) => Math.round(Math.max(0, seconds) / 60);

export function toWidgetData(json, { label, schedule, timeZone, now = new Date() }) {
  const summary = json?.routes?.[0]?.summary;
  if (!Number.isFinite(summary?.travelTimeInSeconds)) throw new Error('TomTom hat keine Route geliefert');
  const delaySeconds = summary.trafficDelayInSeconds ?? 0;
  const normalSeconds = summary.noTrafficTravelTimeInSeconds ?? summary.travelTimeInSeconds - delaySeconds;
  const arrives = Number.isNaN(Date.parse(summary.arrivalTime))
    ? new Date(now.getTime() + summary.travelTimeInSeconds * 1000)
    : new Date(summary.arrivalTime);
  const delayMinutes = minutesOf(delaySeconds);
  return {
    active: true,
    label,
    schedule,
    nextStart: null,
    minutes: minutesOf(summary.travelTimeInSeconds),
    normalMinutes: minutesOf(normalSeconds),
    delayMinutes,
    arrival: zoned(arrives, timeZone).clock,
    distanceKm: Math.round((summary.lengthInMeters ?? 0) / 100) / 10,
    level: levelFor(delayMinutes),
  };
}

export function inactiveData({ label, schedule, nextStart: next }) {
  return {
    active: false,
    label,
    schedule,
    nextStart: next,
    minutes: null,
    normalMinutes: null,
    delayMinutes: null,
    arrival: null,
    distanceKm: null,
    level: null,
  };
}

const labelOf = (config) => setting(config, 'DASH_COMMUTE_LABEL') || 'Ins Büro';

export default {
  id: 'weg',
  intervalMs: 5 * 60_000,
  isConfigured: (config) =>
    Boolean(setting(config, 'DASH_TOMTOM_KEY')) &&
    ENDS.every((end) => setting(config, `DASH_${end}_COORDS`) || setting(config, `DASH_${end}_ADDRESS`)),

  async fetch(ctx) {
    const { config } = ctx;
    const window = readWindow(config);
    const now = ctx.now();
    const base = { label: labelOf(config), schedule: describeWindow(window) };
    if (!isActive(now, window, config.timezone)) {
      return inactiveData({ ...base, nextStart: nextStart(now, window, config.timezone) });
    }
    const key = setting(config, 'DASH_TOMTOM_KEY');
    const [from, to] = await positions(ctx, key);
    const json = await getJson(ctx, routeUrl(from, to, key), key);
    return toWidgetData(json, { ...base, timeZone: config.timezone, now });
  },

  demo({ config }) {
    let schedule = 'Werktags 6–9:30 Uhr';
    try {
      schedule = describeWindow(readWindow(config));
    } catch {
      // invalid window settings: keep the default text, fetch() reports the error
    }
    return {
      active: true,
      label: labelOf(config),
      schedule,
      nextStart: null,
      minutes: 24,
      normalMinutes: 18,
      delayMinutes: 6,
      arrival: '08:19',
      distanceKm: 18.4,
      level: 'zäh',
    };
  },
};
