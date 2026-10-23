// Calendars as iCalendar feeds (RFC 5545), above all Apple's: in the
// Calendar app a calendar shared as "Öffentlicher Kalender" gets a webcal://
// link that anyone with the link can read, no Apple ID needed. Google, Outlook
// and Nextcloud offer the same as "secret address in iCal format".
//
// parseIcs() reads the events, expandEvents() turns them into the occurrences
// inside a time window, in the same shape Home Assistant's calendar API
// returns ({ summary, location, start, end }), so widgets/calendar.js shows
// both alike. Recurring events cover what calendar apps write: DAILY, WEEKLY,
// MONTHLY and YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (also "2MO",
// "-1FR"), BYMONTHDAY, BYMONTH and BYSETPOS, plus EXDATE, moved or
// cancelled single dates (RECURRENCE-ID) and time zones by name (TZID).

const DAY_MS = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_STEPS = 10_000;

/* ---------- reading ---------- */

const unescapeText = (value) => value.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

// One content line → { name, params, value }; the value starts after the
// first colon outside quotes
function parseLine(line) {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [name, ...rest] = line.slice(0, colon).split(';');
  const params = {};
  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

let zoneCache = new Map();
function validZone(name) {
  if (!name) return null;
  if (!zoneCache.has(name)) {
    let ok = true;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: name });
    } catch {
      ok = false;
    }
    if (zoneCache.size > 200) zoneCache = new Map();
    zoneCache.set(name, ok);
  }
  return zoneCache.get(name) ? name : null;
}

// "20261023", "20261023T093000", "20261023T073000Z" with TZID or VALUE=DATE →
// { allDay, y, m, d, h, mi, s, zone } (zone: 'UTC', a TZID, or null = floating)
export function parseDateValue(value, params = {}) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!match) return null;
  const [, y, m, d, h, mi, s, utc] = match;
  const date = { y: Number(y), m: Number(m), d: Number(d) };
  if (h === undefined || params.VALUE === 'DATE') return { ...date, allDay: true, h: 0, mi: 0, s: 0, zone: null };
  return { ...date, allDay: false, h: Number(h), mi: Number(mi), s: Number(s ?? 0), zone: utc ? 'UTC' : validZone(params.TZID) };
}

function parseRule(value) {
  const rule = {};
  for (const part of value.split(';')) {
    const [key, raw = ''] = part.split('=');
    rule[key.toUpperCase()] = raw;
  }
  const list = (key) => (rule[key] ? rule[key].split(',').map((v) => v.trim()).filter(Boolean) : []);
  const numbers = (key) => list(key).map(Number).filter((n) => Number.isInteger(n) && n !== 0);
  const freq = String(rule.FREQ ?? '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  return {
    freq,
    interval: Math.max(1, Number.parseInt(rule.INTERVAL, 10) || 1),
    count: rule.COUNT ? Math.max(1, Number.parseInt(rule.COUNT, 10) || 1) : null,
    until: rule.UNTIL ? parseDateValue(rule.UNTIL) : null,
    byDay: list('BYDAY')
      .map((v) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(v))
      .filter(Boolean)
      .map(([, n, day]) => ({ n: n ? Number(n) : 0, day: WEEKDAYS.indexOf(day.toUpperCase()) })),
    byMonthDay: numbers('BYMONTHDAY'),
    byMonth: numbers('BYMONTH').filter((n) => n >= 1 && n <= 12),
    bySetPos: numbers('BYSETPOS'),
  };
}

// Text of an .ics file → its events (VALARMs and the rest ignored)
export function parseIcs(text) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '') // unfold
    .split('\n');
  const events = [];
  let event = null;
  let depth = 0; // components nested inside the VEVENT, e.g. VALARM
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    const value = prop.value.trim();
    if (prop.name === 'BEGIN') {
      if (event) depth++;
      else if (value.toUpperCase() === 'VEVENT') event = { exdates: [] };
      continue;
    }
    if (prop.name === 'END') {
      if (event && depth) depth--;
      else if (event && value.toUpperCase() === 'VEVENT') {
        if (event.start) events.push(event);
        event = null;
      }
      continue;
    }
    if (!event || depth) continue;
    switch (prop.name) {
      case 'UID':
        event.uid = value;
        break;
      case 'SUMMARY':
        event.summary = unescapeText(prop.value).split('\n')[0].trim();
        break;
      case 'LOCATION':
        event.location = unescapeText(prop.value).split('\n')[0].trim();
        break;
      case 'STATUS':
        event.status = value.toUpperCase();
        break;
      case 'DTSTART':
        event.start = parseDateValue(value, prop.params);
        break;
      case 'DTEND':
        event.end = parseDateValue(value, prop.params);
        break;
      case 'DURATION':
        event.duration = parseDuration(value);
        break;
      case 'RRULE':
        event.rule = parseRule(value);
        break;
      case 'EXDATE':
        for (const part of value.split(',')) {
          const date = parseDateValue(part, prop.params);
          if (date) event.exdates.push(date);
        }
        break;
      case 'RECURRENCE-ID':
        event.recurrenceId = parseDateValue(value, prop.params);
        break;
    }
  }
  return events;
}

// "PT1H30M", "P1D", "-PT15M" → milliseconds
export function parseDuration(value) {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value).trim());
  if (!match) return null;
  const [, sign, w = 0, d = 0, h = 0, m = 0, s = 0] = match;
  const ms = (((Number(w) * 7 + Number(d)) * 24 + Number(h)) * 60 + Number(m)) * 60_000 + Number(s) * 1000;
  return sign === '-' ? -ms : ms;
}

/* ---------- time ---------- */

const formatters = new Map();
function partsIn(zone, ms) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  }
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
}

// Wall-clock time in a time zone → epoch milliseconds (DST-aware)
export function zonedTime({ y, m, d, h = 0, mi = 0, s = 0 }, zone) {
  const wall = Date.UTC(y, m - 1, d, h, mi, s);
  if (!zone || zone === 'UTC') return wall;
  let ms = wall - (partsIn(zone, wall) - wall);
  const again = partsIn(zone, ms) - ms;
  if (wall - again !== ms) ms = wall - again;
  return ms;
}

const dayOf = ({ y, m, d }) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
const dateOf = (day) => {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};
const weekday = (day) => (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isoDate = ({ y, m, d }) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/* ---------- recurrence ---------- */

// The days of one month a MONTHLY/YEARLY rule picks, as day numbers, sorted
function monthDays(y, m, rule, start) {
  const length = daysInMonth(y, m);
  const first = dayOf({ y, m, d: 1 });
  let days;
  if (rule.byDay.length) {
    days = [];
    for (const { n, day } of rule.byDay) {
      const matches = [];
      for (let d = 0; d < length; d++) if (weekday(first + d) === day) matches.push(first + d);
      if (!n) days.push(...matches);
      else if (n > 0 && matches[n - 1] !== undefined) days.push(matches[n - 1]);
      else if (n < 0 && matches[matches.length + n] !== undefined) days.push(matches[matches.length + n]);
    }
    if (rule.byMonthDay.length) {
      const allowed = new Set(rule.byMonthDay.map((n) => (n > 0 ? first + n - 1 : first + length + n)));
      days = days.filter((day) => allowed.has(day));
    }
  } else if (rule.byMonthDay.length) {
    days = rule.byMonthDay.filter((n) => Math.abs(n) <= length).map((n) => (n > 0 ? first + n - 1 : first + length + n));
  } else {
    days = start.d <= length ? [first + start.d - 1] : []; // the 31st skips short months
  }
  days = [...new Set(days)].sort((a, b) => a - b);
  if (rule.bySetPos.length) {
    days = rule.bySetPos.map((n) => (n > 0 ? days[n - 1] : days[days.length + n])).filter((day) => day !== undefined);
    days = [...new Set(days)].sort((a, b) => a - b);
  }
  return days;
}

// The days of the period number `k` (k-th day, week, month or year after
// the start, times INTERVAL), sorted
function periodDays(rule, start, startDay, k) {
  const step = k * rule.interval;
  switch (rule.freq) {
    case 'DAILY':
      return [startDay + step];
    case 'WEEKLY': {
      const monday = startDay - ((weekday(startDay) + 6) % 7) + 7 * step;
      const wanted = rule.byDay.length ? rule.byDay.map(({ day }) => day) : [weekday(startDay)];
      return [...new Set(wanted)].map((day) => monday + ((day + 6) % 7)).sort((a, b) => a - b);
    }
    case 'MONTHLY': {
      const index = start.y * 12 + (start.m - 1) + step;
      return monthDays(Math.floor(index / 12), (index % 12) + 1, rule, start);
    }
    default: {
      const y = start.y + step;
      const months = rule.byMonth.length ? [...rule.byMonth].sort((a, b) => a - b) : [start.m];
      return months.flatMap((m) => monthDays(y, m, rule, start));
    }
  }
}

// A filter on top of the period: BYMONTH for DAILY/WEEKLY/MONTHLY, plain
// BYDAY and BYMONTHDAY for DAILY
function keeps(rule, day) {
  const date = dateOf(day);
  if (rule.freq !== 'YEARLY' && rule.byMonth.length && !rule.byMonth.includes(date.m)) return false;
  if (rule.freq === 'DAILY') {
    if (rule.byDay.length && !rule.byDay.some(({ day: wd }) => wd === weekday(day))) return false;
    if (rule.byMonthDay.length && !rule.byMonthDay.some((n) => (n > 0 ? n === date.d : daysInMonth(date.y, date.m) + n + 1 === date.d))) return false;
  }
  return true;
}

// How many periods lie safely before `day`, so a rule without COUNT can
// skip years of history instead of walking them
function skipTo(rule, startDay, day) {
  if (rule.count || day <= startDay) return 0;
  const span = day - startDay;
  // A month is at most 31 days, a year 366: rather a period too few than one too many
  const per = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[rule.freq] * rule.interval;
  return Math.max(0, Math.floor(span / per) - 2);
}

// Start days of all occurrences up to lastDay (DTSTART is always the first)
function occurrenceDays(event, firstDay, lastDay) {
  const { start, rule } = event;
  const startDay = dayOf(start);
  if (!rule) return startDay <= lastDay ? [startDay] : [];
  const untilDay = rule.until ? (rule.until.allDay || !rule.until.zone ? dayOf(rule.until) : null) : null;
  const untilMs = rule.until && untilDay === null ? zonedTime(rule.until, rule.until.zone) : null;
  const days = [startDay];
  let count = 1;
  let k = skipTo(rule, startDay, firstDay);
  for (let steps = 0; steps < MAX_STEPS; steps++, k++) {
    const period = periodDays(rule, start, startDay, k);
    if (period.length && period[0] > lastDay) break;
    for (const day of period) {
      if (day <= startDay || !keeps(rule, day)) continue;
      if (untilDay !== null && day > untilDay) return days;
      if (untilMs !== null && zonedTime({ ...dateOf(day), h: start.h, mi: start.mi, s: start.s }, start.zone) > untilMs) return days;
      if (day > lastDay) return days;
      days.push(day);
      if (rule.count && ++count >= rule.count) return days;
    }
  }
  return days;
}

/* ---------- occurrences ---------- */

const instantKey = (date, zone) => (date.allDay ? `d${isoDate(date)}` : `t${zonedTime(date, date.zone ?? zone)}`);

// events from parseIcs → [{ summary, location, start, end }] overlapping
// [from, to): all-day as "2026-10-23", timed as ISO time in UTC.
// timezone: for times without a zone ("floating").
export function expandEvents(events, { from, to, timezone = 'UTC' }) {
  const zone = validZone(timezone) ?? 'UTC';
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const firstDay = Math.floor(fromMs / DAY_MS) - 2;
  const lastDay = Math.floor(toMs / DAY_MS) + 1;

  // Single dates that were moved or cancelled replace the series' date
  const replaced = new Map();
  for (const event of events) {
    if (!event.recurrenceId || !event.uid) continue;
    if (!replaced.has(event.uid)) replaced.set(event.uid, new Set());
    replaced.get(event.uid).add(instantKey(event.recurrenceId, event.start.zone ?? zone));
  }

  const out = [];
  for (const event of events) {
    if (event.status === 'CANCELLED') continue;
    const { start } = event;
    const startZone = start.zone ?? zone;
    const firstMs = start.allDay ? null : zonedTime(start, startZone);
    // Length: DTEND, else DURATION, else one day (all-day) or none
    let lengthDays = 1;
    let lengthMs = 0;
    if (start.allDay) {
      if (event.end?.allDay) lengthDays = Math.max(1, dayOf(event.end) - dayOf(start));
      else if (event.duration) lengthDays = Math.max(1, Math.round(event.duration / DAY_MS));
    } else if (event.end) lengthMs = Math.max(0, zonedTime(event.end, event.end.zone ?? zone) - firstMs);
    else if (event.duration) lengthMs = Math.max(0, event.duration);

    const skip = new Set([...(event.exdates ?? []).map((date) => instantKey(date, startZone)), ...(event.rule && event.uid ? (replaced.get(event.uid) ?? []) : [])]);
    const exDays = new Set((event.exdates ?? []).filter((date) => date.allDay).map((date) => dayOf(date)));
    for (const day of occurrenceDays(event, firstDay, lastDay)) {
      const date = dateOf(day);
      if (start.allDay) {
        if (skip.has(`d${isoDate(date)}`)) continue;
        const startMs = zonedTime(date, zone);
        const endMs = zonedTime(dateOf(day + lengthDays), zone);
        if (endMs <= fromMs || startMs >= toMs) continue;
        out.push({ summary: event.summary || 'Termin', location: event.location ?? '', start: isoDate(date), end: isoDate(dateOf(day + lengthDays)) });
      } else {
        const startMs = zonedTime({ ...date, h: start.h, mi: start.mi, s: start.s }, startZone);
        if (skip.has(`t${startMs}`) || exDays.has(day)) continue;
        const endMs = startMs + lengthMs;
        if (Math.max(endMs, startMs + 1) <= fromMs || startMs >= toMs) continue;
        out.push({ summary: event.summary || 'Termin', location: event.location ?? '', start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() });
      }
    }
  }
  return out;
}

// webcal://… (what Apple's "Öffentlicher Kalender" hands out) → https://…
export function feedUrl(text) {
  const value = String(text ?? '').trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export const feedUrls = (setting) =>
  String(setting ?? '')
    .split(/[\s,]+/)
    .map(feedUrl)
    .filter(Boolean);
