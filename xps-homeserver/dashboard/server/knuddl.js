// The XPS as a third device in a Knuddl room (the couple app at
// github.com/PaulWeber-co/DynamicChicken). Knuddl talks to a Firebase
// Realtime Database over plain REST, everything end-to-end encrypted with a
// secret both phones share through their invitation ("ABC123-K7F2M9QX…").
// From that secret both phones, and now the dashboard, derive:
//
//   room  where in the database the couple's data lives (HKDF, 96 bits, base32)
//   key   AES-GCM-256 for every record ({ v: 1, iv, ct }, base64url)
//
// This file mirrors src/util/crypto.js of the app byte for byte, and adds a
// small REST client for the two paths Minifunk uses:
//
//   PUT    <room>/x/status.json     the wall's status, read by the app
//   GET    <room>/x/funk.json       messages the app sent to the wall
//   DELETE <room>/x/funk/<key>.json once a message is safely on the XPS
//
// The dashboard needs only the invitation's secret (DASH_KNUDDL_INVITE) and
// the database URL; it never sees the phones' inboxes.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SALT = enc.encode('knuddl/2024');

export function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// "ABC123-K7F2M9QX4R8TWE7HJ2NP", a whole WhatsApp message or a ?join= link
// → the secret, or null. Like parseInvite() in the app.
export function secretFromInvite(text) {
  const raw = String(text || '')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .trim();
  const link = raw.match(/[?&]join=([A-Za-z0-9-]+)/);
  const candidate = (link ? link[1] : raw).toUpperCase();
  const full = candidate.match(/\b[A-Z0-9]{6}-([A-Z2-9]{16,32})\b/);
  if (full) return full[1];
  return /^[A-Z2-9]{16,32}$/.test(candidate) ? candidate : null;
}

export async function derive(secret) {
  const raw = fromBase32(secret);
  if (!raw.length) throw new Error('Leeres Geheimnis');
  const base = await subtle().importKey('raw', raw, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) });
  const roomBits = await subtle().deriveBits(params('room'), base, 96);
  const key = await subtle().deriveKey(params('content'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { room: toBase32(new Uint8Array(roomBits)), key };
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const unb64 = (text) => new Uint8Array(Buffer.from(String(text), 'base64url'));

export async function seal(key, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return { v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

// null when the record is not ours (another room, tampered, not encrypted)
export async function open(key, box) {
  if (!box || box.v !== 1 || typeof box.iv !== 'string' || typeof box.ct !== 'string') return null;
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(dec.decode(plain));
  } catch {
    return null;
  }
}

// The room's paths under x/ over Firebase's REST API (Minifunk and the lists). fetchJson throws on
// HTTP errors (hub.js); every URL is built from validated parts only.
export async function connectRoom({ url, namespace = 'knuddl', secret, fetchJson, fetchImpl = globalThis.fetch }) {
  const database = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(database)) throw new Error('DASH_KNUDDL_URL muss eine https-Adresse ohne Pfad sein');
  const ns = String(namespace || 'knuddl').replace(/[^A-Za-z0-9_-]/g, '') || 'knuddl';
  const { room, key } = await derive(secret);
  const root = `${database}/${ns}/r/${room}`;
  const json = { 'content-type': 'application/json' };
  return {
    room,
    async writeStatus(status) {
      await fetchJson(`${root}/x/status.json`, { method: 'PUT', headers: json, body: JSON.stringify(await seal(key, status)) });
    },
    // → [{ key, message }], undecryptable records come back as message null
    async readFunks() {
      const records = (await fetchJson(`${root}/x/funk.json`)) ?? {};
      if (typeof records !== 'object') return [];
      const out = [];
      for (const [recordKey, box] of Object.entries(records)) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(recordKey)) continue;
        out.push({ key: recordKey, message: await open(key, box) });
      }
      return out;
    },
    // The lists from the app (to-dos and the top of the bucket list), one
    // package the app rewrites on every change → the decrypted package or null
    async readListe() {
      const box = await fetchJson(`${root}/x/liste.json`);
      return box ? open(key, box) : null;
    },
    async deleteFunk(recordKey) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(recordKey)) return;
      const response = await fetchImpl(`${root}/x/funk/${recordKey}.json`, { method: 'DELETE', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`DELETE x/funk: HTTP ${response.status}`);
    },
    async watchFunks(onChange, signal) {
      return watch('funk', onChange, signal);
    },
    async watchListe(onChange, signal) {
      return watch('liste', onChange, signal);
    },
  };

  // Live: Firebase streams a path as Server-Sent Events ("put"/"patch",
  // a "keep-alive" every 30 s). onChange() runs for every change; resolves
  // when the stream ends, also when it went silent for 90 s.
  async function watch(path, onChange, signal) {
    const silent = new AbortController();
    let watchdog;
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => silent.abort(), 90_000);
      watchdog.unref?.();
    };
    alive();
    const both = AbortSignal.any([signal ?? new AbortController().signal, silent.signal]);
    try {
      const response = await fetchImpl(`${root}/x/${path}.json`, { headers: { accept: 'text/event-stream' }, signal: both });
      if (!response.ok || !response.body) throw new Error(`Stream x/${path}: HTTP ${response.status}`);
      await readEvents(response.body, onChange, alive);
    } catch (error) {
      if (!silent.signal.aborted) throw error;
    } finally {
      clearTimeout(watchdog);
    }
  }
}

async function readEvents(body, onChange, alive) {
  const decoder = new TextDecoder(); // its own: it keeps state between chunks
  let buffer = '';
  for await (const chunk of body) {
    alive();
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: *(.*)$/m.exec(block)?.[1];
      if (event === 'put' || event === 'patch') onChange();
      if (event === 'cancel' || event === 'auth_revoked') return;
    }
    if (buffer.length > 4_000_000) buffer = ''; // a broken stream must not grow forever
  }
}
