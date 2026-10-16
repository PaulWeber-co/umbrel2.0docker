import { esc, icon } from '../util.js';

export const label = 'Zuhause';

export function render(data, { compact = false, entry } = {}) {
  if (!data) return `<div class="lbl">${icon('home')}Zuhause</div><div class="loading">Lädt …</div>`;
  const demo = Boolean(entry?.demo);
  const devices = data.slice(0, 4).map((device) => {
    const on = ['on', 'home', 'open', 'playing'].includes(device.state.toLowerCase());
    const payload = JSON.stringify({ entityId: device.entityId, on: !on });
    if (!device.controllable || demo) return `<div class="switch home-switch home-state" aria-label="${esc(device.name)}: ${esc(device.state)}">
      ${icon(device.domain === 'light' ? 'bulb' : 'home')}<span>${esc(device.name)}</span><strong>${esc(device.state)}${device.unit ? ` ${esc(device.unit)}` : ''}</strong>
    </div>`;
    return `<button class="switch home-switch" type="button" data-action="toggle" data-payload="${esc(payload)}" aria-pressed="${on}">
      ${icon(device.domain === 'light' ? 'bulb' : 'home')}<span>${esc(device.name)}</span><span class="knob"></span>
    </button>`;
  }).join('');
  const listClass = compact ? 'home-list home-list-compact' : 'home-list';
  return `<div class="lbl">${icon('home')}Zuhause<em>${data.length} Geräte</em></div><div class="${listClass}">${devices || '<div class="empty">Keine Geräte verbunden</div>'}</div>`;
}
