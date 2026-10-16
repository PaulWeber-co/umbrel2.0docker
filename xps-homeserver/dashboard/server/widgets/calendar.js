// Calendar ("Kalender") from a Home Assistant calendar entity, e.g. iCloud
// through HA's CalDAV integration or a Google calendar. Home Assistant expands
// recurring events, so the dashboard only lists what comes back:
//   GET /api/calendars/<entity>?start=…&end=…   the next seven days
//
// Settings: DASH_HA_URL, DASH_HA_TOKEN (see home.js) and
//   DASH_HA_CALENDAR_ENTITY   e.g. calendar.privat
import { haConfigured, haRequest } from './home-assistant.js';

const DAY_MS = 24 * 60 * 60_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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

export default {
  id: 'kal',
  intervalMs: 5 * 60_000,
  isConfigured: (config) => haConfigured(config) && /^calendar\.[a-z0-9_]+$/.test(config.get('DASH_HA_CALENDAR_ENTITY')),

  async fetch(ctx) {
    const start = new Date();
    const end = new Date(start.getTime() + 7 * DAY_MS);
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    const entity = encodeURIComponent(ctx.config.get('DASH_HA_CALENDAR_ENTITY'));
    return toWidgetData(await haRequest(ctx, `/api/calendars/${entity}?${params}`), start);
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
