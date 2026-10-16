// Host health tile. Each server value is escaped before it becomes HTML.
import { esc, icon, num } from '../util.js';

export const label = 'Server';

function percent(value) {
  return value === null || value === undefined ? '—' : `${num(value)}%`;
}

function memory(value) {
  if (!value) return { value: '—', detail: 'nicht verfügbar' };
  return { value: `${num(value.percent)}%`, detail: `${num(value.usedGiB, 1)} / ${num(value.totalGiB, 1)} GB` };
}

function uptime(seconds) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days} ${days === 1 ? 'Tag' : 'Tage'}, ${hours} Std.`;
  if (hours) return `${hours} Std., ${minutes} Min.`;
  return `${minutes} Minuten`;
}

function stat(iconName, name, value, detail = '') {
  return `<div class="server-stat">${icon(iconName)}<span class="server-label">${name}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
}

export function render(data) {
  if (!data) return `<div class="lbl">${icon('home')}Server</div><div class="loading">Lädt …</div>`;
  const ram = memory(data.memory);
  const disk = memory(data.storage);
  const temperature = data.temperatureC == null ? '—' : `${num(data.temperatureC)}°`;
  return `
    <div class="lbl">${icon('home')}Server<em>Host</em></div>
    <div class="server-grid">
      ${stat('cpu', 'CPU', percent(data.cpuPercent), 'Auslastung')}
      ${stat('cpu', 'RAM', ram.value, ram.detail)}
      ${stat('home', 'Speicher', disk.value, disk.detail)}
      ${stat('temp', 'Temperatur', temperature, data.temperatureC == null ? 'nicht verfügbar' : 'höchster Sensor')}
    </div>
    <div class="foot">Läuft seit ${esc(uptime(data.uptimeSeconds ?? 0))}</div>`;
}
