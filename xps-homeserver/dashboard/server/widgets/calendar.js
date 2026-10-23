// Calendar ("Kalender"): Apple calendars as iCalendar links and/or a Home
// Assistant calendar entity, merged into one list of the next seven days.
//
//   DASH_CALENDAR_ICS          one or more links, separated by commas: in the
//                              Calendar app on iPhone or Mac a calendar →
//                              Teilen → "Öffentlicher Kalender" gives a
//                              webcal://… link (server/sources/ics.js reads it,
//                              recurring events included). Google and Outlook
//                              have the same as "secret address in iCal format".
//   DASH_HA_CALENDAR_ENTITY    e.g. calendar.privat, with DASH_HA_URL and
//                              DASH_HA_TOKEN (see home.js); Home Assistant
//                              expands recurring events itself:
//                              GET /api/calendars/<entity>?start=…&end=…
import { expandEvents, feedUrls, parseIcs } from '../sources/ics.js';
import { haConfigured, haRequest } from './home-assistant.js';

const DAY_MS = 24 * 60 * 60_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FEED_BYTES = 8 * 1024 * 1024;

// HA sends either "2026-10-16" / "2026-10-16T09:00:00+02:00" or
// { date } / { dateTime } objects; returns the text and whether it is a date.
function moment(value) {
  const text = typeof value === 'string' ? value : value?.dateTime ?? value?.date ?? null;
  return text ? { text, allDay: DATE_ONLY.test(text) } : null;
}

// A date-only value means local midnight of that day, not UTC midnight.
const toTime = ({ text, allDay }) => new Date(allDay ? `${text}T00:00:00` : text).getTime();

export function toWidgetData(events, now = new Date()) {
  return (Array.isArray(events) ? events : [])
    .map((event) => {
      const start = moment(event?.start);
      if (!start) return null;
      const end = moment(event.end);
      // An event without an end lasts a day (all-day) or ends when it starts
      const endsAt = end ? toTime(end) : toTime(start) + (start.allDay ? DAY_MS : 0);
      return { title: String(event.summary ?? 'Termin'), start: start.text, allDay: start.allDay, location: String(event.location ?? ''), endsAt };
    })
    // Keep what has not ended yet: today's all-day events and running meetings stay
    .filter((event) => event && Number.isFinite(event.endsAt) && event.endsAt > now.getTime())
    .sort((a, b) => toTime(moment(a.start)) - toTime(moment(b.start)))
    .slice(0, 5)
    .map(({ endsAt, ...event }) => event);
}

const haCalendar = (config) => (haConfigured(config) && /^calendar\.[a-z0-9_]+$/.test(config.get('DASH_HA_CALENDAR_ENTITY')) ? config.get('DASH_HA_CALENDAR_ENTITY') : '');

async function feedEvents(ctx, url, start, end) {
  const text = await ctx.fetchText(url, { headers: { accept: 'text/calendar, */*;q=0.5' } });
  if (text.length > MAX_FEED_BYTES) throw new Error('Kalender-Link liefert mehr als 8 MB');
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) throw new Error('Kalender-Link liefert keinen iCalendar-Kalender');
  return expandEvents(parseIcs(text), { from: start, to: end, timezone: ctx.config.get('DASH_TIMEZONE', 'Europe/Berlin') });
}

export default {
  id: 'kal',
  intervalMs: 5 * 60_000,
  isConfigured: (config) => Boolean(haCalendar(config) || feedUrls(config.get('DASH_CALENDAR_ICS')).length),

  async fetch(ctx) {
    const start = ctx.now();
    const end = new Date(start.getTime() + 7 * DAY_MS);
    const sources = feedUrls(ctx.config.get('DASH_CALENDAR_ICS')).map((url) => feedEvents(ctx, url, start, end));
    const entity = haCalendar(ctx.config);
    if (entity) {
      const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
      sources.push(haRequest(ctx, `/api/calendars/${encodeURIComponent(entity)}?${params}`));
    }
    // One calendar that cannot be reached does not hide the others
    const results = await Promise.allSettled(sources);
    const events = results.filter((result) => result.status === 'fulfilled').flatMap((result) => (Array.isArray(result.value) ? result.value : []));
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length === results.length && failed.length) throw failed[0].reason;
    for (const { reason } of failed) ctx.log.warn(`[kal] ${reason?.message ?? reason}`);
    return toWidgetData(events, start);
  },

  demo: ({ now } = {}) => {
    const at = (now?.() ?? new Date()).getTime();
    return [
      { title: 'Team-Stand-up', start: new Date(at + 90 * 60_000).toISOString(), allDay: false, location: 'Videoanruf' },
      { title: 'Paket abholen', start: new Date(at + 26 * 60 * 60_000).toISOString(), allDay: false, location: '' },
      { title: 'Geburtstag Oma', start: new Date(at + 2 * DAY_MS).toISOString().slice(0, 10), allDay: true, location: '' },
    ];
  },
};
