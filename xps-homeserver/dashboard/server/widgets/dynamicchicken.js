// Key figures of DynamicChicken, the user's own web app (a static site on
// GitHub Pages with a Firebase Realtime Database). Its data model is not fixed
// yet, so the widget is generic: every key figure names a path in the database
// and how to turn the node there into one value. One REST request per key
// figure every 5 minutes, all in parallel:
//   GET {DASH_DC_DB_URL}/{path}.json[?shallow=true][&auth=…]
// A missing node answers null and shows as "–"; a failing key figure shows "–"
// and is marked error: true, only when all of them fail does fetch() throw.
//
// Settings:
//   DASH_DC_DB_URL  Realtime Database URL (required), e.g.
//                   https://dynamicchicken-default-rtdb.europe-west1.firebasedatabase.app
//   DASH_DC_AUTH    database secret or ID token (optional, only for databases
//                   whose rules do not allow public reads)
//   DASH_DC_KPIS    key figures (required), separated by ";", each "Label=path"
//                   or "Label=path|mode", e.g.
//                   "Hühner=chickens|count; Eier heute=stats/eggsToday; Zuletzt aktiv=lastActivity|time"
//
// Modes: value (default) the number or text as it is; count the children of an
// object (requested with shallow=true, so Firebase answers { "key": true, … }
// instead of the whole tree); sum the numeric children added up; time a
// timestamp (ms since 1970 or ISO text; numbers below 1e11 count as seconds)
// as "vor 5 min", "gestern", "12. Okt.", in DASH_TIMEZONE.
//
// Firebase only accepts database secrets and ID tokens as the auth= query
// parameter (the Authorization header is for Google OAuth tokens), so every
// error message and log line is scrubbed of it before it leaves this module.
import { redact } from '../hub.js';

export const MODES = ['value', 'count', 'sum', 'time'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
// Firebase keys may not contain these characters; "." would also let a path
// climb out of the database with "..".
const FORBIDDEN = /[.#$[\]\u0000-\u001f\u007f]/;
const MAX_TEXT = 100;

const setting = (config, key) => String(config.get(key, '')).trim();

// "https://x.firebasedatabase.app/" → "https://x.firebasedatabase.app"
export const baseUrl = (url) => String(url ?? '').trim().replace(/\/+$/, '');

const invalidKpi = (entry) =>
  new Error(`DASH_DC_KPIS: "${entry}" ist ungültig (erwartet Name=Pfad oder Name=Pfad|Modus, Modus: ${MODES.join(', ')})`);

// "Hühner=chickens|count; Eier heute=/stats/eggsToday" →
// [{ label: 'Hühner', path: 'chickens', mode: 'count' },
//  { label: 'Eier heute', path: 'stats/eggsToday', mode: 'value' }]
export function parseKpis(text) {
  const kpis = [];
  for (const raw of String(text ?? '').split(';')) {
    const entry = raw.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    const label = entry.slice(0, Math.max(eq, 0)).trim();
    let rest = entry.slice(eq + 1);
    let mode = 'value';
    const pipe = rest.lastIndexOf('|');
    if (pipe >= 0) {
      mode = rest.slice(pipe + 1).trim().toLowerCase();
      rest = rest.slice(0, pipe);
    }
    // "/stats//eggsToday/" → "stats/eggsToday"
    const path = rest.trim().split('/').filter(Boolean).join('/');
    if (eq < 1 || !label || !path || FORBIDDEN.test(path) || !MODES.includes(mode)) throw invalidKpi(entry);
    kpis.push({ label, path, mode });
  }
  if (!kpis.length) throw new Error('DASH_DC_KPIS enthält keine Kennzahl');
  return kpis;
}

// The REST URL of one key figure; count asks only for the child keys.
export function kpiUrl(db, { path, mode }, auth = '') {
  const params = new URLSearchParams();
  if (mode === 'count') params.set('shallow', 'true');
  if (auth) params.set('auth', auth);
  const query = params.toString();
  const segments = path.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl(db)}/${segments}.json${query ? `?${query}` : ''}`;
}

// Removes the secret from a message in every spelling, also where it is not an
// auth= parameter, then any other auth= in a URL with redact(). Only the URLs
// go through redact(): on the whole message it would also swallow the
// ": HTTP 401" after one. A URL ends before trailing ":", ",", ";", "." or ")".
export function hideSecret(message, secret) {
  let text = String(message ?? '');
  if (secret) {
    const forms = [secret, encodeURIComponent(secret), new URLSearchParams({ a: secret }).toString().slice(2)];
    for (const form of new Set(forms)) text = text.split(form).join('…');
  }
  return text.replace(/https?:\/\/\S*[^\s:,;.)]/gi, (url) => redact(url));
}

// German number as num() in web/js/util.js would show it: 18432 → "18.432",
// 4.75 → "4,75". The tile formats numbers itself, display is the fallback.
export const formatNumber = (value) => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });

const isObject = (value) => value !== null && typeof value === 'object';
const children = (node) => (Array.isArray(node) ? node.filter((v) => v !== null) : Object.values(node));

export function count(node) {
  if (!isObject(node)) throw new Error('ist kein Objekt, count zählt nur Unterknoten');
  return children(node).length;
}

export function sum(node) {
  if (typeof node === 'number') return node;
  if (!isObject(node)) throw new Error('ist keine Zahl und kein Objekt mit Zahlen');
  const values = children(node);
  const numbers = values.filter(Number.isFinite);
  if (values.length && !numbers.length) throw new Error('enthält keine Zahlen');
  const total = numbers.reduce((a, b) => a + b, 0);
  // 0.1 + 0.2 → 0.3 instead of 0.30000000000000004
  return Number.isInteger(total) ? total : Number(total.toFixed(9));
}

// A timestamp as a Date: ms since 1970 (as number or digits) or ISO text.
// Numbers below 1e11 are taken as seconds: in ms they would be before 1974.
export function toDate(value) {
  let ms = NaN;
  if (typeof value === 'number') ms = value;
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) ms = Number(value);
  else if (typeof value === 'string') ms = Date.parse(value);
  if (Number.isFinite(ms) && ms > 0 && ms < 1e11) ms *= 1000;
  const date = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(date.getTime())) throw new Error('ist keine Zeitangabe');
  return date;
}

// Calendar date of an instant in the given time zone (never the zone of the
// machine the server runs on), plus a day number to compare dates.
function calendar(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(date)
      .map(({ type, value }) => [type, Number(value)]),
  );
  const { year, month, day } = parts;
  return { days: Date.UTC(year, month - 1, day) / DAY, year, month, day };
}

// "gerade eben", "vor 5 min", "vor 2 h" (same day), "gestern", else "12. Okt."
// ("12. Okt. 2025" in another year). Future times show their date.
export function relativeTime(date, now, timeZone = 'Europe/Berlin') {
  const ago = now.getTime() - date.getTime();
  const then = calendar(date, timeZone);
  const today = calendar(now, timeZone);
  if (Math.abs(ago) < MINUTE) return 'gerade eben';
  if (ago > 0 && ago < HOUR) return `vor ${Math.floor(ago / MINUTE)} min`;
  if (ago > 0 && then.days === today.days) return `vor ${Math.floor(ago / HOUR)} h`;
  if (ago > 0 && then.days === today.days - 1) return 'gestern';
  const short = `${then.day}. ${MONTHS[then.month - 1]}`;
  return then.year === today.year ? short : `${short} ${then.year}`;
}

function plainValue(node) {
  if (typeof node === 'number') return { value: node, display: formatNumber(node) };
  if (typeof node === 'boolean') return { value: node, display: node ? 'ja' : 'nein' };
  if (typeof node === 'string') {
    const text = node.trim() || '–';
    return { value: node, display: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text };
  }
  throw new Error('ist ein Objekt, dafür Modus count oder sum verwenden');
}

// One Firebase answer → { label, display, value, error }. value is the number,
// the text, true/false or, for time, the ISO timestamp. Throws when the node
// does not fit the mode; fetch() then marks this key figure as failed.
export function toKpi({ label, mode }, node, { now = new Date(), timeZone = 'Europe/Berlin' } = {}) {
  if (node === null || node === undefined) return { label, display: '–', value: null, error: false };
  let result;
  if (mode === 'count') {
    const n = count(node);
    result = { value: n, display: formatNumber(n) };
  } else if (mode === 'sum') {
    const n = sum(node);
    result = { value: n, display: formatNumber(n) };
  } else if (mode === 'time') {
    const date = toDate(node);
    result = { value: date.toISOString(), display: relativeTime(date, now, timeZone) };
  } else {
    result = plainValue(node);
  }
  return { label, ...result, error: false };
}

export const failedKpi = (label) => ({ label, display: '–', value: null, error: true });

export default {
  id: 'dc',
  intervalMs: 5 * 60_000,
  isConfigured: (config) => Boolean(baseUrl(setting(config, 'DASH_DC_DB_URL')) && setting(config, 'DASH_DC_KPIS')),

  async fetch(ctx) {
    const { config } = ctx;
    const db = baseUrl(setting(config, 'DASH_DC_DB_URL'));
    // The URL is not echoed: a pasted "?auth=…" would end up in the log.
    if (!/^https?:\/\/[^/?#\s]+(\/[^?#\s]*)?$/i.test(db)) {
      throw new Error(
        'DASH_DC_DB_URL muss eine Adresse wie https://<projekt>-default-rtdb.europe-west1.firebasedatabase.app sein, ohne ?… (den Schlüssel in DASH_DC_AUTH eintragen)',
      );
    }
    const kpis = parseKpis(setting(config, 'DASH_DC_KPIS'));
    const auth = setting(config, 'DASH_DC_AUTH');
    const now = ctx.now();
    const timeZone = config.timezone ?? 'Europe/Berlin';

    const settled = await Promise.allSettled(
      kpis.map(async (kpi) => {
        const where = `${kpi.label} (${kpi.path})`;
        let node;
        try {
          node = await ctx.fetchJson(kpiUrl(db, kpi, auth));
        } catch (error) {
          throw new Error(`${where}: ${hideSecret(error.message, auth)}`);
        }
        try {
          return toKpi(kpi, node, { now, timeZone });
        } catch (error) {
          throw new Error(`${where} ${error.message}`);
        }
      }),
    );

    const failures = settled.filter((result) => result.status === 'rejected').map((result) => result.reason.message);
    if (failures.length === kpis.length) throw new Error(`DynamicChicken: keine Kennzahl abrufbar, ${failures[0]}`);
    for (const failure of failures) ctx.log?.warn?.(`[dc] ${failure}`);
    return {
      placeholder: false,
      kpis: settled.map((result, i) => (result.status === 'fulfilled' ? result.value : failedKpi(kpis[i].label))),
    };
  },

  demo: () => ({
    placeholder: true,
    kpis: [
      { label: '[Kennzahl 1]', display: '–', value: null, error: false },
      { label: '[Kennzahl 2]', display: '–', value: null, error: false },
    ],
  }),
};
