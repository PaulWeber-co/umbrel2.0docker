// Home tile ("Zuhause"): the Home Assistant entities chosen in DASH_HA_ENTITIES.
// The first switchable one (light, switch, fan ...) is a switch, up to two
// more follow as rows; without a switchable entity up to three rows.
// Data comes from server/widgets/home.js, which already turns every state into
// German text (display); values pass through esc().
// Styles for the ho-* classes live in web/css/w-home.css: names end in "…",
// the switch stacks in 1×1 tiles and a row that does not fit is left out.
import { esc, icon } from '../util.js';

export const label = 'Zuhause';

const HEAD = `<div class="lbl">${icon('home')}Zuhause</div>`;
const UNREACHABLE = '<small class="ho-muted">nicht erreichbar</small>';

const unreachable = (item) => item.missing || item.state === 'unavailable' || item.state === 'unknown';

// An entity Home Assistant cannot reach gets a disabled switch without
// data-action, so a tap does not pretend to switch it.
function toggle(item) {
  const name = `<span class="ho-label"><span class="ho-name">${esc(item.name)}</span>${unreachable(item) ? UNREACHABLE : ''}</span>`;
  const pressed = `aria-pressed="${item.on === true}"`;
  if (unreachable(item)) {
    return `<button class="switch ho-switch ho-na" type="button" ${pressed} disabled>${icon(item.icon)}${name}<i class="knob"></i></button>`;
  }
  // data-payload is JSON inside a single-quoted attribute: esc() turns its
  // quotes into entities, the browser turns them back before app.js parses it.
  const payload = esc(JSON.stringify({ id: item.id }));
  return `<button class="switch ho-switch" type="button" data-action="toggle" data-payload='${payload}' ${pressed}>${icon(item.icon)}${name}<i class="knob"></i></button>`;
}

// "21,5 °C innen": the value first, the name muted behind it (below it in 1×1
// tiles). An entity that cannot be reached shows its name and "nicht erreichbar".
function row(item) {
  const off = unreachable(item);
  const text = off
    ? `<span class="ho-name">${esc(item.name)}</span>${UNREACHABLE}`
    : `<b class="ho-val">${esc(item.display)}</b><span class="ho-name ho-muted">${esc(item.name)}</span>`;
  return `<div class="row ho-row${off ? ' ho-na' : ''}">${icon(item.icon)}<span class="ho-stack">${text}</span></div>`;
}

// compact (music mode, 172 / 428 px) needs no markup of its own: w-home.css
// switches between one-line and stacked layout by the tile's actual width.
export function render(data, { compact = false } = {}) {
  if (!data) return `${HEAD}<div class="loading">Lädt …</div>`;
  const items = Array.isArray(data.entities) ? data.entities : [];
  if (!items.length) return `${HEAD}<div class="sub ho-muted">Keine Geräte eingestellt</div>`;

  const first = items.find((item) => item.toggleable);
  const rows = items.filter((item) => item !== first).slice(0, first ? 2 : 3);
  return `
    ${HEAD}
    <div class="ho">
      ${first ? toggle(first) : ''}
      <div class="ho-rows">${rows.map(row).join('')}</div>
    </div>`;
}
