import { esc, icon, num } from '../util.js';

export const label = 'Arbeitsweg';

export function render(data) {
  if (!data) return `<div class="lbl">${icon('work')}Arbeitsweg</div><div class="loading">Lädt …</div>`;
  return `
    <div class="lbl">${icon('work')}Arbeitsweg<em>${esc(data.destination)}</em></div>
    <div class="commute-main"><span class="big">${num(data.minutes)}<small>Min.</small></span></div>
    <div class="foot">${num(data.kilometers, 1)} km · Route ohne Verkehrslage</div>`;
}
