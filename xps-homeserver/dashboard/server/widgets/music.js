// Shairport Sync sends its XML metadata items as small UDP datagrams on the
// host loopback interface. This widget keeps only the current track in memory.
import { createSocket } from 'node:dgram';

let current = {
  active: false,
  title: '',
  artist: '',
  album: '',
  coverDataUrl: '',
  positionSeconds: null,
  durationSeconds: null,
  progressAt: null,
};
let lastMessageAt = 0;
const ACTIVE_TIMEOUT_MS = 12_000;

function decodeCode(value = '') {
  if (/^[a-f\d]{8}$/i.test(value)) return Buffer.from(value, 'hex').toString('ascii');
  return value.trim();
}

function decodePayload(value = '') {
  const compact = value.replace(/\s/g, '');
  if (!compact) return Buffer.alloc(0);
  try {
    return Buffer.from(compact, 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}

function imageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

export function parseMetadata(packet) {
  const text = Buffer.isBuffer(packet) ? packet.toString('utf8') : String(packet);
  const items = [];
  for (const match of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const type = decodeCode(item.match(/<type>([\s\S]*?)<\/type>/i)?.[1]);
    const code = decodeCode(item.match(/<code>([\s\S]*?)<\/code>/i)?.[1]);
    const encoded = item.match(/<data\b[^>]*>([\s\S]*?)<\/data>/i)?.[1] ?? '';
    items.push({ type, code, bytes: decodePayload(encoded) });
  }
  return items;
}

function readText(bytes) {
  return bytes.toString('utf8').replace(/\0+$/g, '').trim();
}

function applyMetadata(items) {
  let changed = false;
  for (const { code, bytes } of items) {
    if (code === 'minm' || code === 'asar' || code === 'asal') {
      const value = readText(bytes);
      if (!value) continue;
      const key = code === 'minm' ? 'title' : code === 'asar' ? 'artist' : 'album';
      if (current[key] !== value) {
        current = { ...current, [key]: value };
        changed = true;
      }
    } else if (code.toLowerCase() === 'pict') {
      const mime = imageMime(bytes);
      if (!mime) continue;
      const coverDataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
      if (current.coverDataUrl !== coverDataUrl) {
        current = { ...current, coverDataUrl };
        changed = true;
      }
    } else if (code === 'prgr') {
      const [startText, positionText, endText] = readText(bytes).split('/');
      const [start, position, end] = [startText, positionText, endText].map(Number);
      if (![start, position, end].every(Number.isFinite)) continue;
      const frames = (from, to) => (to - from + 0x1_0000_0000) % 0x1_0000_0000;
      const durationSeconds = frames(start, end) / 44_100;
      const positionSeconds = Math.min(durationSeconds, frames(start, position) / 44_100);
      if (durationSeconds > 0 && Number.isFinite(positionSeconds)) {
        current = { ...current, positionSeconds, durationSeconds, progressAt: Date.now() };
        changed = true;
      }
    }
  }
  return changed;
}

function snapshot(now = Date.now()) {
  return { ...current, active: now - lastMessageAt < ACTIVE_TIMEOUT_MS };
}

export default {
  id: 'music',
  intervalMs: 5_000,

  fetch() {
    return snapshot();
  },

  watch(ctx, emit) {
    const port = ctx.config.num('DASH_MUSIC_UDP_PORT', 5555);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('DASH_MUSIC_UDP_PORT muss zwischen 1 und 65535 liegen');
    const socket = createSocket('udp4');
    socket.on('message', (packet) => {
      lastMessageAt = Date.now();
      if (applyMetadata(parseMetadata(packet))) emit(snapshot());
    });
    socket.on('error', (error) => ctx.log.warn(`[music] UDP: ${error.message}`));
    socket.bind(port, '127.0.0.1');
    return () => socket.close();
  },

  demo: () => ({ active: false, title: '', artist: '', album: '', coverDataUrl: '', positionSeconds: null, durationSeconds: null, progressAt: null }),
};
