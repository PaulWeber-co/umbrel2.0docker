// Photo backup tile ("Fotos-Backup"): for each Umbrel account how many photos
// and videos the Umbrel app has backed up and how much space they take. Two
// people fit with their photo count large; more get one line each. Data from
// server/widgets/backup.js, every value through esc(). Styles in
// web/css/w-backup.css.
import { esc, icon, num } from '../util.js';
import { size } from './fotos.js';

export const label = 'Fotos-Backup';

const HEAD = `<div class="lbl">${icon('photo')}Fotos-Backup</div>`;

const videos = (count) => `${num(count)} ${count === 1 ? 'Video' : 'Videos'}`;

// "48.120" needs a smaller size than "292" to fit 188 px (172 in music mode)
export const fit = (text) => (text.length >= 7 ? ' bk-l7' : text.length >= 5 ? ' bk-l5' : '');

function person(entry) {
  return `
    <div class="bk-person">
      <div class="bk-top"><span class="bk-name">${esc(entry.name)}</span><span class="bk-size">${esc(size(entry.bytes))}</span></div>
      <div class="bk-count${fit(num(entry.photos))}"><b>${esc(num(entry.photos))}</b> ${entry.photos === 1 ? 'Foto' : 'Fotos'}</div>
      <div class="bk-videos">${esc(videos(entry.videos))}</div>
    </div>`;
}

function line(entry) {
  return `<li class="bk-line"><span class="bk-name">${esc(entry.name)}</span><span>${esc(num(entry.photos))}</span><span class="bk-size">${esc(size(entry.bytes))}</span></li>`;
}

export function render(data) {
  if (!data) return `${HEAD}<div class="loading">Lädt …</div>`;
  const people = Array.isArray(data.people) ? data.people : [];
  if (!people.length) return `${HEAD}<div class="sub">Noch kein Konto mit Backup</div>`;
  if (people.length <= 2) return `${HEAD}<div class="bk">${people.map(person).join('')}</div>`;
  return `${HEAD}<ul class="bk-lines">${people.slice(0, 5).map(line).join('')}</ul>`;
}
