// Calendar from Home Assistant: what counts as upcoming, in which order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toWidgetData } from '../server/widgets/calendar.js';

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
