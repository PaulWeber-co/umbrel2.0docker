// Services tile ("Dienste"): one row per Umbrel app or compose project with a
// status dot, CPU, memory and uptime; problems come first (the server sorts).
// Data from server/widgets/services.js, every value through esc(). In a 1×1
// tile (or music mode) w-dienste.css hides memory and uptime.
import { esc, icon, num } from '../util.js';

export const label = 'Dienste';

const HEAD = (extra = '') => `<div class="lbl">${icon('stack')}Dienste${extra}</div>`;
const ROWS = 4;

// 680 MiB → "680 MB", 1.5 GiB → "1,5 GB"
export function bytes(value) {
  if (!Number.isFinite(value)) return '–';
  const mb = value / 1024 ** 2;
  return mb >= 1000 ? `${num(mb / 1024, 1)} GB` : `${num(mb)} MB`;
}

// 9 days → "9 T", 5 hours → "5 Std", 40 minutes → "40 Min"
export function uptime(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)} T`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} Std`;
  return `${Math.max(1, Math.floor(seconds / 60))} Min`;
}

const cpu = (value) => (Number.isFinite(value) ? `${num(value, value < 10 ? 1 : 0)} %` : '–');

const STATUS = { ok: 'läuft', warn: 'Problem', down: 'aus' };

function row(service) {
  const detail = service.status === 'ok'
    ? `<span class="di-num">${esc(cpu(service.cpuPercent))}</span><span class="di-num di-mem">${esc(bytes(service.memBytes))}</span><span class="di-num di-up">${esc(uptime(service.uptimeSeconds))}</span>`
    : `<span class="di-problem">${esc(service.problem ?? STATUS[service.status])}</span>`;
  const count = service.total > 1 ? `<small>${esc(service.running)}/${esc(service.total)}</small>` : '';
  return `<li class="di-row di-${esc(service.status)}"><i class="di-dot" aria-label="${esc(STATUS[service.status] ?? '')}"></i><span class="di-name">${esc(service.name)}${count}</span>${detail}</li>`;
}

export function render(data) {
  if (!data) return `${HEAD()}<div class="loading">Lädt …</div>`;
  const services = Array.isArray(data.services) ? data.services : [];
  if (!services.length) return `${HEAD()}<div class="sub">Noch keine Dienste gefunden</div>`;
  const problems = (data.counts?.warn ?? 0) + (data.counts?.down ?? 0);
  const summary = problems ? `${problems} mit Problem` : `alle ${services.length} laufen`;
  const more = services.length > ROWS ? `<div class="di-more">+ ${services.length - ROWS} weitere</div>` : '';
  const umbrel = data.umbrelError ? '<div class="di-more">Umbrel-Apps gerade nicht abfragbar</div>' : '';
  return `
    ${HEAD(`<em>${esc(summary)}</em>`)}
    <div class="di">
      <div class="di-head" aria-hidden="true"><span></span><span>CPU</span><span class="di-mem">RAM</span><span class="di-up">seit</span></div>
      <ul class="di-list">${services.slice(0, ROWS).map(row).join('')}</ul>
      ${umbrel || more}
    </div>`;
}
