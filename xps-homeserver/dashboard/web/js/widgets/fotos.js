import { esc, icon, num } from '../util.js';

export const label = 'Fotos';

function gib(bytes) {
  if (!Number.isFinite(bytes)) return 'Speicher nicht verfügbar';
  return `${num(bytes / 1024 ** 3, 1)} GB belegt`;
}

export function render(data) {
  if (!data) return `<div class="lbl">${icon('photo')}Fotos</div><div class="loading">Lädt …</div>`;
  const content = `
    <div class="lbl">${icon('photo')}Fotos<em>Immich</em></div>
    <div class="photo-count">${data.photos == null ? '—' : num(data.photos)}</div>
    <div class="photo-detail">Fotos · ${data.videos == null ? '—' : num(data.videos)} Videos</div>
    <div class="foot">${esc(gib(data.usageBytes))}</div>`;
  return data.url
    ? `<a class="photo-link" href="${esc(data.url)}" target="_blank" rel="noopener noreferrer">${content}</a>`
    : content;
}
