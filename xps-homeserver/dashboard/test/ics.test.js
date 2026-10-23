import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandEvents, feedUrl, feedUrls, parseDuration, parseIcs, zonedTime } from '../server/sources/ics.js';

// Like an export of Apple's Calendar: time zone block, alarms, folded lines,
// escaped commas, CRLF
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//macOS 15.0//EN',
  'X-WR-CALNAME:Privat',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'DTSTART:19810329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'TZNAME:MESZ',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  // daily at 09:00 Berlin, ten times, across the end of summer time on 25 Oct
  'BEGIN:VEVENT',
  'UID:standup',
  'DTSTART;TZID=Europe/Berlin:20261020T090000',
  'DTEND;TZID=Europe/Berlin:20261020T091500',
  'RRULE:FREQ=DAILY;COUNT=10',
  'SUMMARY:Stand-up',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'SUMMARY:Erinnerung',
  'TRIGGER:-PT10M',
  'END:VALARM',
  'END:VEVENT',
  // weekly Mon + Wed: Wednesday 28 off, Monday 26 moved to 11:00
  'BEGIN:VEVENT',
  'UID:yoga',
  'DTSTART;TZID=Europe/Berlin:20260907T090000',
  'DURATION:PT1H',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
  'EXDATE;TZID=Europe/Berlin:20261028T090000',
  'SUMMARY:Yoga',
  'LOCATION:Studio\\, 2. Stock',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:yoga',
  'RECURRENCE-ID;TZID=Europe/Berlin:20261026T090000',
  'DTSTART;TZID=Europe/Berlin:20261026T110000',
  'DTEND;TZID=Europe/Berlin:20261026T120000',
  'SUMMARY:Yoga (verschoben)',
  'END:VEVENT',
  // a birthday since 1990
  'BEGIN:VEVENT',
  'UID:oma',
  'DTSTART;VALUE=DATE:19901027',
  'DTEND;VALUE=DATE:19901028',
  'RRULE:FREQ=YEARLY',
  'SUMMARY:Geburtstag Oma',
  'END:VEVENT',
  // the last Friday of every month
  'BEGIN:VEVENT',
  'UID:kino',
  'DTSTART;TZID=Europe/Berlin:20260130T180000',
  'DTEND;TZID=Europe/Berlin:20260130T200000',
  'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
  'SUMMARY:Kinoabend',
  'END:VEVENT',
  // every evening until 24 Oct, 18:00 UTC
  'BEGIN:VEVENT',
  'UID:kur',
  'DTSTART;TZID=Europe/Berlin:20261001T200000',
  'RRULE:FREQ=DAILY;UNTIL=20261024T180000Z',
  'SUMMARY:Tabletten',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:urlaub',
  'DTSTART;VALUE=DATE:20261022',
  'DTEND;VALUE=DATE:20261025',
  'SUMMARY:Urlaub',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:abgesagt',
  'DTSTART;TZID=Europe/Berlin:20261024T100000',
  'STATUS:CANCELLED',
  'SUMMARY:Abgesagt',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:essen',
  'DTSTART:20261029T193000',
  'SUMMARY:Abendessen mit',
  '  Freunden\\, Lea',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:outlook',
  'DTSTART;TZID="W. Europe Standard Time":20261027T150000',
  'SUMMARY:Zahnarzt',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:utc',
  'DTSTART:20261028T120000Z',
  'DTEND:20261028T130000Z',
  'SUMMARY:Call',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const window = { from: new Date('2026-10-23T00:00:00+02:00'), to: new Date('2026-10-31T00:00:00+01:00'), timezone: 'Europe/Berlin' };
const titled = (list, summary) => list.filter((event) => event.summary === summary);

test('reads the events of an Apple calendar export', () => {
  const events = parseIcs(ICS);
  assert.equal(events.length, 11);
  const standup = events.find((event) => event.uid === 'standup');
  assert.equal(standup.summary, 'Stand-up', 'the alarm keeps its own SUMMARY');
  assert.deepEqual(standup.rule.count, 10);
  assert.equal(events.find((event) => event.uid === 'essen').summary, 'Abendessen mit Freunden, Lea');
  assert.equal(events.find((event) => event.uid === 'yoga' && !event.recurrenceId).location, 'Studio, 2. Stock');
});

test('recurring events become the dates inside the window', () => {
  const list = expandEvents(parseIcs(ICS), window);

  // 09:00 Berlin is 07:00 UTC in summer time, 08:00 UTC from Sunday on
  assert.deepEqual(
    titled(list, 'Stand-up').map((event) => event.start),
    ['2026-10-23T07:00:00.000Z', '2026-10-24T07:00:00.000Z', '2026-10-25T08:00:00.000Z', '2026-10-26T08:00:00.000Z', '2026-10-27T08:00:00.000Z', '2026-10-28T08:00:00.000Z', '2026-10-29T08:00:00.000Z'],
  );
  assert.equal(titled(list, 'Stand-up')[0].end, '2026-10-23T07:15:00.000Z');

  assert.deepEqual(titled(list, 'Yoga'), [], 'Monday moved, Wednesday off');
  assert.deepEqual(titled(list, 'Yoga (verschoben)').map((event) => [event.start, event.end]), [['2026-10-26T10:00:00.000Z', '2026-10-26T11:00:00.000Z']]);

  assert.deepEqual(titled(list, 'Geburtstag Oma').map((event) => [event.start, event.end]), [['2026-10-27', '2026-10-28']]);
  assert.deepEqual(titled(list, 'Kinoabend').map((event) => event.start), ['2026-10-30T17:00:00.000Z'], 'last Friday of October');
  assert.deepEqual(titled(list, 'Tabletten').map((event) => event.start), ['2026-10-23T18:00:00.000Z', '2026-10-24T18:00:00.000Z'], 'up to UNTIL, inclusive');
  assert.deepEqual(titled(list, 'Urlaub').map((event) => [event.start, event.end]), [['2026-10-22', '2026-10-25']], 'began before the window, still running');
  assert.deepEqual(titled(list, 'Abgesagt'), []);
  assert.deepEqual(titled(list, 'Abendessen mit Freunden, Lea').map((event) => event.start), ['2026-10-29T18:30:00.000Z'], 'floating time in DASH_TIMEZONE');
  assert.deepEqual(titled(list, 'Zahnarzt').map((event) => event.start), ['2026-10-27T14:00:00.000Z'], 'unknown zone name: DASH_TIMEZONE');
  assert.deepEqual(titled(list, 'Call').map((event) => event.start), ['2026-10-28T12:00:00.000Z']);
});

test('months without the day are skipped; intervals and BYMONTH work', () => {
  const ics = (rule, start = 'DTSTART:20260131T120000Z') => `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\n${start}\nRRULE:${rule}\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR`;
  const span = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-07-01T00:00:00Z'), timezone: 'Europe/Berlin' };
  const days = (rule, start) => expandEvents(parseIcs(ics(rule, start)), span).map((event) => event.start.slice(0, 10));
  assert.deepEqual(days('FREQ=MONTHLY'), ['2026-01-31', '2026-03-31', '2026-05-31']);
  assert.deepEqual(days('FREQ=MONTHLY;BYMONTHDAY=-1'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  assert.deepEqual(days('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA;COUNT=4', 'DTSTART:20260103T100000Z'), ['2026-01-03', '2026-01-17', '2026-01-31', '2026-02-14']);
  assert.deepEqual(days('FREQ=YEARLY;BYMONTH=5;BYDAY=2SU', 'DTSTART;VALUE=DATE:20200510'), ['2026-05-10'], 'Muttertag');
  assert.deepEqual(days('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'DTSTART:20260130T080000Z'), ['2026-01-30', '2026-02-27', '2026-03-31', '2026-04-30', '2026-05-29', '2026-06-30'], 'last weekday');
  assert.deepEqual(days('FREQ=DAILY;BYDAY=SA,SU;BYMONTH=2', 'DTSTART:20260201T080000Z').slice(0, 3), ['2026-02-01', '2026-02-07', '2026-02-08']);
});

test('a daily event from years ago costs no walk through its history', () => {
  const ics = 'BEGIN:VEVENT\nUID:alt\nDTSTART;TZID=Europe/Berlin:20000101T073000\nRRULE:FREQ=DAILY\nSUMMARY:Kaffee\nEND:VEVENT';
  const started = performance.now();
  const list = expandEvents(parseIcs(ics), window);
  assert.ok(performance.now() - started < 50);
  assert.equal(list.length, 8);
  assert.equal(list[0].start, '2026-10-23T05:30:00.000Z');
});

test('time zones, durations, feed links', () => {
  assert.equal(new Date(zonedTime({ y: 2026, m: 3, d: 29, h: 3 }, 'Europe/Berlin')).toISOString(), '2026-03-29T01:00:00.000Z');
  assert.equal(new Date(zonedTime({ y: 2026, m: 7, d: 1, h: 12 }, 'America/New_York')).toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(parseDuration('PT1H30M'), 90 * 60_000);
  assert.equal(parseDuration('P1W'), 7 * 86_400_000);
  assert.equal(parseDuration('kaputt'), null);
  assert.equal(feedUrl('webcal://p52-caldav.icloud.com/published/2/MTIz'), 'https://p52-caldav.icloud.com/published/2/MTIz');
  assert.equal(feedUrl('file:///etc/passwd'), null);
  assert.deepEqual(feedUrls('webcal://a.example/x.ics, https://b.example/y.ics\nkaputt'), ['https://a.example/x.ics', 'https://b.example/y.ics']);
});
