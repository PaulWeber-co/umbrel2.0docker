// Commute tile ("Arbeitsweg"): drive time with live traffic inside the
// configured morning window, otherwise when the next window starts.
// Data comes from server/widgets/commute.js; values pass through esc().
// Styles for the weg-* classes live in web/css/w-weg.css.
import { esc, icon, num } from '../util.js';

export const label = 'Arbeitsweg';

// The label sits in its own span so a long DASH_COMMUTE_LABEL ends in "…".
const head = (text) => `<div class="lbl">${icon('car')}<span class="weg-name">${esc(text)}</span></div>`;

const km = (value) => num(value, value >= 100 ? 0 : 1);

// "Werktags 6–9:30 Uhr": the time range stays on one line, so a narrow tile
// breaks after the days and never after the dash.
function schedule(text) {
  const [, days, hours] = String(text).match(/^(.*) (\S+ Uhr)$/) ?? [];
  return hours ? `${esc(days)} <span class="weg-nw">${esc(hours)}</span>` : esc(text);
}

function traffic(data) {
  if (data.level === 'frei') return '<div class="pill weg-pill weg-frei">frei</div>';
  if (!Number.isFinite(data.delayMinutes)) return '';
  // "Stau" from 10 min on keeps the pill inside the narrow music-mode tile
  return `<div class="pill weg-pill">+${num(data.delayMinutes)} min ${data.level === 'stau' ? 'Stau' : 'Verkehr'}</div>`;
}

// compact (music mode, 172 px wide) needs no layout of its own: every line
// either fits or wraps between its parts.
export function render(data, { compact = false } = {}) {
  if (!data) return `${head('Arbeitsweg')}<div class="loading">Lädt …</div>`;

  if (!data.active) {
    return `
      ${head(data.label)}
      ${data.schedule ? `<div class="sub">${schedule(data.schedule)}</div>` : ''}
      ${data.nextStart ? `<div class="foot">nächste Fahrt <span class="weg-nw">${esc(data.nextStart)}</span></div>` : ''}`;
  }

  const minutes = data.minutes;
  const big = Number.isFinite(minutes)
    ? `<div class="big${minutes >= 100 ? ' long' : ''}">${num(minutes)}<small>min</small></div>`
    : '<div class="ph">–</div>';
  const foot = [
    data.arrival ? `<span class="weg-nw">an ${esc(data.arrival)}</span>` : '',
    Number.isFinite(data.distanceKm) ? `<span class="weg-nw">${km(data.distanceKm)} km</span>` : '',
  ].filter(Boolean);
  return `
    ${head(data.label)}
    ${big}
    ${traffic(data)}
    ${foot.length ? `<div class="foot weg-foot">${foot.join(' · ')}</div>` : ''}`;
}
