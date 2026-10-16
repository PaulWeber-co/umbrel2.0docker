// Host health tile (the XPS itself, also while Umbrel updates). Each value is
// escaped before it becomes HTML; w-server.css shrinks it for 1×1 tiles.
import { esc, icon, num } from '../util.js';

export const label = 'XPS';

function percent(value) {
  return value === null || value === undefined ? '—' : `${num(value)}%`;
}

function memory(value) {
  if (!value) return { value: '—', detail: 'nicht verfügbar' };
  return { value: `${num(value.percent)}%`, detail: `${num(value.usedGiB, 1)} / ${num(value.totalGiB, 1)} GB` };
}

function uptime(seconds) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3_600);
  if (days) return `${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
  if (hours) return `${hours} Std.`;
  return `${Math.max(1, Math.floor(seconds / 60))} Min.`;
}

function stat(iconName, name, value, detail = '') {
  return `<div class="server-stat">${icon(iconName)}<span class="server-label">${name}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
}

export function render(data) {
  if (!data) return `<div class="lbl">${icon('cpu')}XPS</div><div class="loading">Lädt …</div>`;
  const ram = memory(data.memory);
  const disk = memory(data.storage);
  const temperature = data.temperatureC == null ? '—' : `${num(data.temperatureC)}°`;
  return `
    <div class="lbl">${icon('cpu')}XPS</div>
    <div class="server-wrap"><div class="server-grid">
      ${stat('cpu', 'CPU', percent(data.cpuPercent), 'Auslastung')}
      ${stat('stack', 'RAM', ram.value, ram.detail)}
      ${stat('disk', 'SSD', disk.value, disk.detail)}
      ${stat('temp', 'Temp.', temperature, data.temperatureC == null ? 'nicht verfügbar' : 'höchster Sensor')}
    </div></div>
    <div class="foot">Läuft seit ${esc(uptime(data.uptimeSeconds ?? 0))}</div>`;
}
