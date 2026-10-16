import { esc, icon } from '../util.js';

export const label = 'Kalender';

function when(event) {
  if (event.allDay) return new Date(`${event.start}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  return new Date(event.start).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function render(data) {
  if (!data) return `<div class="lbl">${icon('cal')}Kalender</div><div class="loading">Lädt …</div>`;
  const items = data.length
    ? data.slice(0, 4).map((event) => `<li><time>${esc(when(event))}</time><strong>${esc(event.title)}</strong>${event.location ? `<small>${esc(event.location)}</small>` : ''}</li>`).join('')
    : '<li class="empty">Keine Termine in den nächsten sieben Tagen</li>';
  return `<div class="lbl">${icon('cal')}Kalender<em>7 Tage</em></div><ol class="calendar-list">${items}</ol>`;
}
