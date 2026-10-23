// Who may reach the dashboard and who may change things.
//
// Reading stays open in the home network: the wall shows everything anyway.
// Three checks keep other web pages and other devices out:
//
//   Host       only names used at home or over Tailscale (xps.local, an IP
//              address, xps.tailnet.ts.net, …). A foreign page whose domain a
//              DNS trick points at the XPS ("DNS rebinding") gets nothing.
//   changes    (POST/PUT under /api/) only as JSON and only from the
//              dashboard's own origin. A page on another site cannot send
//              JSON without the browser asking first, and nobody answers.
//   PIN        optional, DASH_PIN: changes from other devices need the PIN
//              once per browser (a cookie), or in the header x-dashboard-pin
//              (Home Assistant's rest_command). The kiosk on the XPS itself
//              (127.0.0.1) never asks.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const HOME_SUFFIXES = ['.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain', '.fritz.box', '.speedport.ip', '.ts.net'];
const COOKIE = 'xps_dash';
const MAX_FAILURES = 5;
const LOCKOUT_MS = 10 * 60_000;

export const isLoopback = (address) => /^(::ffff:)?127\./.test(String(address ?? '')) || address === '::1';

// "xps.local:7777" → "xps.local"; "[fe80::1]:7777" → "fe80::1"
export function hostName(header) {
  const text = String(header ?? '').trim().toLowerCase();
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    return end > 1 ? text.slice(1, end) : '';
  }
  return text.replace(/:\d*$/, '').replace(/\.$/, '');
}

export function isAllowedHost(header, extra = []) {
  const host = hostName(header);
  if (!host) return false;
  if (host.includes(':')) return true; // an IPv6 address
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host === 'localhost' || !host.includes('.')) return true; // "xps"
  return HOME_SUFFIXES.some((suffix) => host.endsWith(suffix)) || extra.includes(host);
}

// The Origin header of a change must name this very dashboard.
export function isSameOrigin(origin, hostHeader) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === String(hostHeader ?? '').toLowerCase();
  } catch {
    return false;
  }
}

const parseList = (text) =>
  String(text ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

const digest = (text) => createHash('sha256').update(String(text)).digest();

export function createAccess({ config, store, now = () => Date.now() }) {
  const get = (key) => String(config.get?.(key, '') ?? '').trim();
  const pin = get('DASH_PIN');
  const allowedHosts = parseList(get('DASH_ALLOWED_HOSTS'));
  const failures = new Map(); // address → { count, until }
  let secret = null;

  // A random key in the data directory; the cookie is an HMAC of the PIN with
  // it, so a new PIN logs every browser out and the cookie reveals nothing.
  async function token() {
    if (!secret) {
      const saved = await store.read('secret.json', null);
      if (typeof saved?.secret === 'string' && saved.secret.length >= 32) secret = saved.secret;
      else {
        secret = randomBytes(32).toString('hex');
        await store.write('secret.json', { secret });
      }
    }
    return createHmac('sha256', secret).update(`pin:${pin}`).digest('hex');
  }

  async function unlocked(req) {
    const value = cookieValue(req.headers.cookie, COOKIE);
    return Boolean(value) && timingSafeEqual(digest(value), digest(await token()));
  }

  // Five wrong PINs from one address lock it out for ten minutes
  function checkPin(address, attempt) {
    const record = failures.get(address);
    if (record && record.until > now()) {
      throw Object.assign(new Error('Zu viele Versuche, bitte in 10 Minuten noch einmal'), { status: 429 });
    }
    if (typeof attempt === 'string' && timingSafeEqual(digest(attempt.trim()), digest(pin))) {
      failures.delete(address);
      return true;
    }
    // A lockout that has run out starts the count again
    const count = (record && !record.until ? record.count : 0) + 1;
    failures.set(address, { count, until: count >= MAX_FAILURES ? now() + LOCKOUT_MS : 0 });
    return false;
  }

  return {
    allowedHosts,
    pinSet: Boolean(pin),
    isAllowedHost: (header) => isAllowedHost(header, allowedHosts),

    async status(req) {
      const local = isLoopback(req.socket.remoteAddress);
      const free = !pin || local;
      return { local, pinRequired: !free, locked: !free && !(await unlocked(req)) };
    },

    async canChange(req) {
      if (!pin || isLoopback(req.socket.remoteAddress) || (await unlocked(req))) return true;
      const header = req.headers['x-dashboard-pin'];
      return header !== undefined && checkPin(req.socket.remoteAddress, header);
    },

    // → the Set-Cookie value; throws 401 for a wrong PIN, 429 after five
    async unlock(req, attempt) {
      if (!pin) return null;
      if (!checkPin(req.socket.remoteAddress, attempt)) throw Object.assign(new Error('Falsche PIN'), { status: 401 });
      return `${COOKIE}=${await token()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;
    },
  };
}
