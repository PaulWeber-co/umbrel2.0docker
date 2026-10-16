// Weather tile. Reference for every widget module:
//   label    the name shown in edit mode
//   render(data, { compact }) → HTML for the tile body. data is null while
//            loading. compact is true in music mode, when the tile is narrower.
// Data comes from server/widgets/weather.js; values pass through esc().
import { esc, icon } from '../util.js';

export const label = 'Wetter';

export function render(data, { compact = false } = {}) {
  if (!data) return `<div class="lbl">${icon('cloudsun')}Wetter</div><div class="loading">Lädt …</div>`;
  const { now, today, hours, place } = data;
  const rain = today.rainFrom ? `ab ${esc(today.rainFrom)} Regen` : 'trocken';
  return `
    <div class="lbl">${icon(now.icon)}Wetter<em>${esc(place)}</em></div>
    <div class="wx${compact ? ' compact' : ''}">
      <div class="wx-now">
        <div class="big">${esc(now.temp)}°</div>
        <div class="sub">${esc(now.text)}, ${rain}<br>max. ${esc(today.max)}° · min. ${esc(today.min)}°</div>
      </div>
      <ol class="hours">
        ${hours.map((h) => `<li><span>${esc(h.label)}</span>${icon(h.icon)}<b>${esc(h.temp)}°</b></li>`).join('')}
      </ol>
    </div>`;
}
