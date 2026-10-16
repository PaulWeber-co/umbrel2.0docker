// Photo tile: how many photos and videos Immich holds, how many were taken in
// the last seven days or, when there are none, the disk space the library uses.
// Data comes from server/widgets/photos.js; values pass through esc().
// Styles in web/css/w-fotos.css.
import { esc, icon, num } from '../util.js';

export const label = 'Fotos';

const GB = 1024 ** 3;
const TB = 1024 ** 4;

// Storage size in 1024-based units, German style: "3,4 GB", "96 GB", "1,2 TB".
export function size(bytes) {
  const gb = bytes / GB;
  if (gb >= 1023.5) return `${num(bytes / TB, 1)} TB`;
  if (gb >= 9.95) return `${num(gb)} GB`;
  return `${num(gb, 1)} GB`;
}

// Onest's tabular digits are about 0.65em wide, so "18.432" at the 56 px of
// .big.long is already 195 px. Longer counts step down (see w-fotos.css) to
// fit 188 px and the 172 px of music mode. num() never makes 4 or 8 characters.
export function fit(text) {
  if (text.length >= 10) return ' fo-l10';
  if (text.length >= 8) return ' fo-l8';
  if (text.length >= 6) return ` fo-l${text.length}`;
  return '';
}

function foot({ addedThisWeek, usageBytes }) {
  if (addedThisWeek > 0) {
    const added = num(addedThisWeek);
    return `<div class="foot fo-line${added.length >= 5 ? ' fo-small' : ''}">+${esc(added)} diese Woche</div>`;
  }
  if (Number.isFinite(usageBytes)) return `<div class="foot fo-line">${esc(size(usageBytes))}</div>`;
  return '';
}

export function render(data, { compact = false } = {}) {
  if (!data) return `<div class="lbl">${icon('photo')}Fotos</div><div class="loading">Lädt …</div>`;
  const images = num(data.images);
  const videos = data.total === 0 ? 'Noch leer' : `${num(data.videos)} ${data.videos === 1 ? 'Video' : 'Videos'}`;
  return `
    <div class="lbl">${icon('photo')}Fotos</div>
    <div class="fo${compact ? ' compact' : ''}">
      <div class="big long fo-n${fit(images)}">${esc(images)}</div>
      <div class="sub fo-line">${esc(videos)}</div>
      ${foot(data)}
    </div>`;
}
