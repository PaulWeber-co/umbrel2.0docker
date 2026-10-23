import { esc, icon } from '../util.js';

export const label = 'Kalender';

const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// "Heute 09:30", "Morgen 14:00", "So 25.10." (all day) or "Mi 28.10. 18:00":
// short enough for one line in the tile, in the browser's (the kiosk's) time zone.
export function when(event, now = new Date()) {
  const start = event.allDay ? new Date(`${event.start}T12:00:00`) : new Date(event.start);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day =
    dayKey(start) === dayKey(now)
      ? 'Heute'
      : dayKey(start) === dayKey(tomorrow)
        ? 'Morgen'
        : `${start.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')} ${start.getDate()}.${start.getMonth() + 1}.`;
  if (event.allDay) return day;
  return `${day} ${start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

export function render(data) {
  if (!data) return `<div class="lbl">${icon('cal')}Kalender</div><div class="loading">Lädt …</div>`;
  const items = data.length
    ? data.slice(0, 4).map((event) => `<li><time>${esc(when(event))}</time><strong>${esc(event.title)}</strong>${event.location ? `<small>${esc(event.location)}</small>` : ''}</li>`).join('')
    : '<li class="empty">Keine Termine in den nächsten sieben Tagen</li>';
  return `<div class="lbl">${icon('cal')}Kalender<em>7 Tage</em></div><ol class="calendar-list">${items}</ol>`;
}
