import { haConfigured, haRequest } from './home-assistant.js';

const iso = (date) => date.toISOString();

export function toWidgetData(events, now = new Date()) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({
      title: String(event.summary ?? 'Termin'),
      start: typeof event.start === 'string' ? event.start : event.start?.dateTime ?? event.start?.date ?? null,
      allDay: Boolean(typeof event.start === 'string' ? /^\d{4}-\d{2}-\d{2}$/.test(event.start) : event.start?.date && !event.start?.dateTime),
      location: String(event.location ?? ''),
    }))
    .filter((event) => event.start && new Date(event.start) >= new Date(now.getTime() - 60 * 60_000))
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 5);
}

export default {
  id: 'kal',
  intervalMs: 5 * 60_000,
  isConfigured: (config) => haConfigured(config) && Boolean(config.get('DASH_HA_CALENDAR_ENTITY')),

  async fetch(ctx) {
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60_000);
    const params = new URLSearchParams({ start: iso(start), end: iso(end) });
    const entity = encodeURIComponent(ctx.config.get('DASH_HA_CALENDAR_ENTITY'));
    return toWidgetData(await haRequest(ctx, `/api/calendars/${entity}?${params}`));
  },

  demo: () => [
    { title: 'Team-Stand-up', start: new Date(Date.now() + 90 * 60_000).toISOString(), allDay: false, location: 'Videoanruf' },
    { title: 'Paket abholen', start: new Date(Date.now() + 26 * 60 * 60_000).toISOString(), allDay: false, location: '' },
  ],
};
