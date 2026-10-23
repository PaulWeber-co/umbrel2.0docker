// Calendar from Apple (iCalendar links) and Home Assistant: what counts as
// upcoming, in which order, and how the sources merge.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import calendar, { toWidgetData } from '../server/widgets/calendar.js';

const now = new Date('2026-10-16T07:30:00+02:00');

test("today's all-day events and running meetings stay, ended ones go", () => {
  const events = toWidgetData(
    [
      { summary: 'Später', start: { dateTime: '2026-10-16T15:00:00+02:00' }, end: { dateTime: '2026-10-16T16:00:00+02:00' } },
      { summary: 'Geburtstag', start: { date: '2026-10-16' }, end: { date: '2026-10-17' } },
      { summary: 'Läuft', start: { dateTime: '2026-10-16T07:00:00+02:00' }, end: { dateTime: '2026-10-16T08:00:00+02:00' } },
      { summary: 'Vorbei', start: { dateTime: '2026-10-16T06:00:00+02:00' }, end: { dateTime: '2026-10-16T07:00:00+02:00' } },
      { summary: 'Gestern', start: '2026-10-15', end: '2026-10-16' },
    ],
    now,
  );
  assert.deepEqual(events.map((e) => e.title), ['Geburtstag', 'Läuft', 'Später']);
  assert.deepEqual(events[0], { title: 'Geburtstag', start: '2026-10-16', allDay: true, location: '' });
});

test('events without an end, broken entries and the limit of five', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ summary: `T${i}`, start: `2026-10-${20 + i}` }));
  assert.equal(toWidgetData([...many, { summary: 'kaputt' }, null], now).length, 5);
  assert.deepEqual(toWidgetData('nope', now), []);
});

test('calendar tile names days the short way', async () => {
  const { when } = await import('../web/js/widgets/kal.js');
  const now = new Date(2026, 9, 21, 12, 0);
  assert.equal(when({ start: new Date(2026, 9, 21, 18, 30).toISOString(), allDay: false }, now), 'Heute 18:30');
  assert.equal(when({ start: new Date(2026, 9, 22, 9, 5).toISOString(), allDay: false }, now), 'Morgen 09:05');
  assert.equal(when({ start: '2026-10-25', allDay: true }, now), 'So 25.10.');
  assert.equal(when({ start: '2026-10-21', allDay: true }, now), 'Heute');
});

test('Apple calendar links and Home Assistant end up in one list; a dead link hides nothing', async () => {
  const settings = {
    DASH_CALENDAR_ICS: 'webcal://p52-caldav.icloud.com/published/2/privat, https://kaputt.example/kal.ics',
    DASH_HA_URL: 'http://ha.local:8123',
    DASH_HA_TOKEN: 't',
    DASH_HA_CALENDAR_ENTITY: 'calendar.familie',
    DASH_TIMEZONE: 'Europe/Berlin',
  };
  const config = { get: (key, fallback = '') => settings[key] ?? fallback };
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=Europe/Berlin:20261016T090000\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Sport\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const asked = [];
  const warnings = [];
  const ctx = {
    config,
    now: () => now,
    log: { warn: (text) => warnings.push(text) },
    async fetchText(url) {
      asked.push(url);
      if (url.includes('kaputt')) throw new Error('GET https://kaputt.example/kal.ics: HTTP 404');
      return ics;
    },
    async fetchJson(url) {
      asked.push(url.split('?')[0]);
      return [{ summary: 'Elternabend', start: { dateTime: '2026-10-19T19:00:00+02:00' }, end: { dateTime: '2026-10-19T21:00:00+02:00' } }];
    },
  };
  assert.ok(calendar.isConfigured(config));
  const events = await calendar.fetch(ctx);
  assert.deepEqual(asked, ['https://p52-caldav.icloud.com/published/2/privat', 'https://kaputt.example/kal.ics', 'http://ha.local:8123/api/calendars/calendar.familie']);
  assert.deepEqual(events.map((event) => [event.title, event.start]), [
    ['Sport', '2026-10-16T07:00:00.000Z'],
    ['Elternabend', '2026-10-19T19:00:00+02:00'],
  ], 'seven days: the training a week later is just outside');
  assert.equal(warnings.length, 1);

  // Only broken links: the tile says so instead of an empty week
  settings.DASH_CALENDAR_ICS = 'https://kaputt.example/kal.ics';
  delete settings.DASH_HA_CALENDAR_ENTITY;
  await assert.rejects(calendar.fetch(ctx), /HTTP 404/);
  assert.equal(calendar.isConfigured({ get: () => '' }), false);
});
