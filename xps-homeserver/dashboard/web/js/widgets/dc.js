// DynamicChicken tile: the first key figure large with its label below, the
// second one as "Label: Wert" at the bottom. Without DASH_DC_KPIS the server
// sends placeholder data and the tile says where to enter the key figures.
// Data comes from server/widgets/dynamicchicken.js; values pass through esc().
// Styles for the dc-* classes live in web/css/w-dc.css.
import { esc, icon, num } from '../util.js';

export const label = 'DynamicChicken';

// The name sits in its own span so it ends in "…" in the narrow music mode.
const HEAD = `<div class="lbl">${icon('trend')}<span class="dc-name">DynamicChicken</span></div>`;

// As many decimals as the number has, at most two: 4.5 → 1, 3.14159 → 2.
export function decimals(value) {
  if (Number.isInteger(value)) return 0;
  const cents = Math.round(Math.abs(value) * 100);
  return cents % 100 === 0 ? 0 : cents % 10 === 0 ? 1 : 2;
}

// Numbers in German via num(), everything else (text, "vor 5 min", "–") as
// the server's display.
export function text(kpi) {
  return Number.isFinite(kpi?.value) ? num(kpi.value, decimals(kpi.value)) : String(kpi?.display ?? '–');
}

// Size classes for the big value by its length. Onest's tabular digits are
// about 0.65em wide, so like the photo tile numbers step down to fit 188 px
// (172 px in music mode) on one line; text of 8 and more characters takes
// 40 px and may wrap onto a second line instead. See web/css/w-dc.css.
export function fit(value, numeric) {
  const length = [...value].length;
  if (length <= 4) return '';
  if (length === 5) return ' long';
  if (length <= 7) return ` long dc-l${length}`;
  if (!numeric) return ' long dc-l8 dc-wrap';
  if (length >= 10) return ' long dc-l10';
  return length === 9 ? ' long dc-l9' : ' long dc-l8';
}

// "vor 12 min" wraps before "12 min", never between number and unit.
const glue = (value) => esc(value).replace(/(\d) /g, '$1&nbsp;');

export function render(data, { compact = false } = {}) {
  if (!data) return `${HEAD}<div class="loading">Lädt …</div>`;
  const body = (html) => `${HEAD}<div class="dc${compact ? ' compact' : ''}">${html}</div>`;

  if (data.placeholder) {
    return body(`
      <div class="ph dc-ph">[Kennzahl]</div>
      <div class="foot dc-hint">Kennzahlen in .env eintragen (DASH_DC_KPIS)</div>`);
  }

  const [first, second] = Array.isArray(data.kpis) ? data.kpis : [];
  if (!first) {
    return body(`
      <div class="ph dc-ph">–</div>
      <div class="foot dc-hint">Keine Kennzahlen eingetragen</div>`);
  }

  const value = text(first);
  return body(`
      <div class="big dc-big${fit(value, Number.isFinite(first.value))}${first.error ? ' dc-err' : ''}">${glue(value)}</div>
      <div class="sub dc-line">${esc(first.label)}</div>
      ${second ? `<div class="foot dc-foot">${esc(second.label)}: ${glue(text(second))}</div>` : ''}`);
}
