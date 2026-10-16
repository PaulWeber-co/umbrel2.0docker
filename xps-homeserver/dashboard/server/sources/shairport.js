// AirPlay metadata from shairport-sync, the AirPlay 2 receiver on the XPS.
// shairport-sync writes every piece of metadata into a named pipe as an item:
//
//   <item><type>636f7265</type><code>6d696e6d</code><length>11</length>
//   <data encoding="base64">
//   V2VpdGVzIExhbmQ=</data></item>
//
// type and code are four ASCII characters as hex ("core" items come from the
// sending device, "ssnc" items from shairport-sync itself); data is base64 and
// only present when length > 0. Three parts, each tested on its own:
//
//   MetadataParser     byte stream → items, survives split chunks and garbage
//   PlayerState        items → what the dashboard shows (see inactiveState())
//   createPipeReader   FIFO → chunks without blocking the event loop
//
// createShairportSource() puts them together. DASH_SHAIRPORT_PIPE chooses the
// pipe; shairport-sync.conf needs metadata = { enabled = "yes";
// include_cover_art = "yes"; pipe_name = "<the same path>"; }.
import fs from 'node:fs';
import net from 'node:net';

export const DEFAULT_PIPE = '/run/shairport-sync/metadata';
export const SAMPLE_RATE = 44100; // prgr counts RTP frames at 44.1 kHz
export const MAX_COVER_BYTES = 1.5 * 1024 * 1024; // larger covers are ignored
export const MAX_BUFFER = 8 * 1024 * 1024; // an unfinished item may not grow beyond this
export const END_DELAY_MS = 3000; // after "play end" music mode stays a moment
export const PAUSE_TIMEOUT_MS = 5 * 60_000; // paused this long: back to normal mode
const PROGRESS_GRACE_MS = 2000; // progress this fresh belongs to the next track too
const MAX_DURATION_S = 12 * 3600; // longer means a stream without an end

const round = (value) => Math.round(value * 1000) / 1000;

// "73736e63" → "ssnc"
export const fourcc = (hex) => Buffer.from(hex, 'hex').toString('latin1');

/* ---------- stream → items ---------- */

const HEAD = /<type>([0-9a-fA-F]{8})<\/type>\s*<code>([0-9a-fA-F]{8})<\/code>\s*<length>(\d+)<\/length>/;
const DATA = /<data[^>]*>([^<]*)<\/data>/;

// One complete "<item>…</item>" → { type, code, length, data: Buffer }, or
// null when it is not a valid item.
export function parseItem(text) {
  const head = HEAD.exec(text);
  if (!head) return null;
  const length = Number(head[3]);
  const match = length > 0 ? DATA.exec(text) : null;
  const data = match ? Buffer.from(match[1].replace(/\s+/g, ''), 'base64') : Buffer.alloc(0);
  return { type: fourcc(head[1]), code: fourcc(head[2]), length, data };
}

const OPEN = '<item>';
const CLOSE = '</item>';

// Feed it chunks in any size; it calls onItem(item) for every complete item.
// Text outside items is dropped, an item cut off by the next "<item>" is
// skipped, and an item that never ends is dropped at maxBuffer characters.
export class MetadataParser {
  #buffer = '';
  #scanned = 0; // neither OPEN nor CLOSE occurs in #buffer before this index (after the first OPEN)
  #onItem;
  #maxBuffer;

  constructor(onItem, { maxBuffer = MAX_BUFFER } = {}) {
    this.#onItem = onItem;
    this.#maxBuffer = maxBuffer;
  }

  get buffered() {
    return this.#buffer.length;
  }

  reset() {
    this.#buffer = '';
    this.#scanned = 0;
  }

  push(chunk) {
    // latin1: one character per byte, so a chunk border never splits a character
    this.#buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('latin1');
    for (;;) {
      const start = this.#buffer.indexOf(OPEN);
      if (start === -1) {
        // Keep only what could be the beginning of a cut-off "<item>"
        this.#buffer = this.#buffer.slice(-(OPEN.length - 1));
        this.#scanned = 0;
        return;
      }
      if (start > 0) {
        this.#buffer = this.#buffer.slice(start);
        this.#scanned = 0;
      }
      const from = Math.max(OPEN.length, this.#scanned);
      const end = this.#buffer.indexOf(CLOSE, from);
      const next = this.#buffer.indexOf(OPEN, from);
      if (next !== -1 && (end === -1 || next < end)) {
        // This item was cut off (the writer died mid-item): skip to the next one
        this.#buffer = this.#buffer.slice(next);
        this.#scanned = 0;
        continue;
      }
      if (end === -1) {
        if (this.#buffer.length > this.#maxBuffer) this.reset();
        else this.#scanned = Math.max(OPEN.length, this.#buffer.length - CLOSE.length + 1);
        return;
      }
      const text = this.#buffer.slice(0, end + CLOSE.length);
      this.#buffer = this.#buffer.slice(end + CLOSE.length);
      this.#scanned = 0;
      const item = parseItem(text);
      if (item) this.#onItem(item);
    }
  }
}

/* ---------- item payloads ---------- */

// prgr "start/current/end" in RTP frames → seconds. The frame counter is 32
// bit and wraps around, so differences are taken as signed 32-bit numbers.
export function parseProgress(text) {
  const match = /^(\d+)\/(\d+)\/(\d+)$/.exec(String(text).trim());
  if (!match) return null;
  const [start, current, end] = match.slice(1).map(Number);
  const length = ((end - start) | 0) / SAMPLE_RATE;
  const duration = length > 0 && length <= MAX_DURATION_S ? round(length) : null;
  let position = Math.max(0, ((current - start) | 0) / SAMPLE_RATE);
  if (duration !== null) position = Math.min(position, duration);
  return { position: round(position), duration };
}

// pvol "airplay_volume,volume,lowest,highest": AirPlay volume -30 … 0 dB,
// -144 means muted → 0 … 1
export function parseVolume(text) {
  const airplay = Number.parseFloat(String(text).split(',')[0]);
  if (!Number.isFinite(airplay)) return null;
  if (airplay <= -144) return 0;
  return round(Math.min(1, Math.max(0, (airplay + 30) / 30)));
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Cover bytes → their media type by magic bytes, only JPEG and PNG
export function sniffImage(bytes) {
  if (bytes?.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes?.length >= 8 && PNG.every((byte, i) => bytes[i] === byte)) return 'image/png';
  return null;
}

export function coverDataUrl(bytes) {
  if (!bytes?.length || bytes.length > MAX_COVER_BYTES) return null;
  const type = sniffImage(bytes);
  return type ? `data:${type};base64,${Buffer.from(bytes).toString('base64')}` : null;
}

/* ---------- items → player state ---------- */

// What the music widget publishes, here with nothing playing.
export const inactiveState = () => ({
  active: false, // music mode on the dashboard
  playing: false, // false while paused
  title: '',
  artist: '',
  album: '',
  source: '', // the sending device, "Pauls iPhone"
  coverUrl: null, // data:image/jpeg;base64,… or null
  position: null, // seconds at positionAt
  duration: null, // seconds, null when unknown
  positionAt: null, // epoch ms of position
  volume: null, // 0 … 1
});

const TRACK_FIELDS = { minm: 'title', asar: 'artist', asal: 'album' };
const TRACK_KEYS = Object.values(TRACK_FIELDS);

// Turns items into the state above and calls onChange(state) with a new
// object after every change, including the timed switches to inactive.
// now, setTimer and clearTimer are replaceable for tests.
export class PlayerState {
  #state = inactiveState();
  #now;
  #setTimer;
  #clearTimer;
  #onChange;
  #timer = null;
  #session = null; // true after pbeg, false after pend, null = unknown (started mid-session)
  #bundle = null; // core fields collected between mdst and mden
  #coverFresh = false; // a PICT arrived since the bundle started
  #progressAt = -Infinity; // when the last prgr arrived
  #dirty = false;

  constructor({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {} } = {}) {
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#onChange = onChange;
  }

  get state() {
    return { ...this.#state };
  }

  handle(item) {
    this.#apply(item);
    this.#flush();
  }

  dispose() {
    this.#cancel();
  }

  #apply({ type, code, data = Buffer.alloc(0) }) {
    const text = () => data.toString('utf8').trim();
    if (type === 'core') {
      const field = TRACK_FIELDS[code];
      if (!field) return;
      if (this.#bundle) this.#bundle[field] = text();
      else this.#track({ [field]: text() }, false);
      return;
    }
    if (type !== 'ssnc') return;
    switch (code) {
      case 'pbeg': // play begin
      case 'prsm': // resume after pause or flush (AirPlay 2 also sends "pres")
      case 'pres':
        this.#session = true;
        this.#resume();
        break;
      case 'pfls': // flush: pause or skip (AirPlay 2 also sends "paus")
      case 'paus':
        this.#pause();
        if (this.#session !== false && this.#state.active) this.#schedule(PAUSE_TIMEOUT_MS, () => this.#set({ active: false }));
        break;
      case 'pend': // play end
        this.#session = false;
        this.#pause();
        this.#schedule(END_DELAY_MS, () => this.#set({ ...inactiveState(), volume: this.#state.volume }));
        break;
      case 'mdst':
        this.#bundle = {};
        this.#coverFresh = false;
        break;
      case 'mden':
        if (this.#bundle) this.#track(this.#bundle, true);
        this.#bundle = null;
        break;
      case 'PICT':
        this.#cover(data);
        break;
      case 'prgr': {
        const progress = parseProgress(text());
        if (!progress) break;
        this.#progressAt = this.#now();
        this.#set({ ...progress, positionAt: this.#progressAt });
        break;
      }
      case 'pvol': {
        const volume = parseVolume(text());
        if (volume !== null) this.#set({ volume });
        break;
      }
      case 'snam':
        this.#set({ source: text() });
        break;
      default: // pcst, pcen, snua, pffr, stal …: nothing to show
    }
  }

  // A bundle (complete: missing fields are unknown) or a single core item.
  #track(fields, complete) {
    if (!TRACK_KEYS.some((key) => key in fields)) return;
    const next = Object.fromEntries(TRACK_KEYS.map((key) => [key, fields[key] ?? (complete ? '' : this.#state[key])]));
    if (TRACK_KEYS.every((key) => next[key] === this.#state[key])) return;
    // A new track: the old cover goes unless the new one already came, and the
    // old progress goes unless it just arrived (it may precede the metadata).
    const patch = { ...next };
    if (!this.#coverFresh) patch.coverUrl = null;
    if (this.#now() - this.#progressAt > PROGRESS_GRACE_MS) Object.assign(patch, { position: null, duration: null, positionAt: null });
    this.#set(patch);
    if (this.#session !== false) this.#resume();
  }

  #cover(bytes) {
    if (bytes.length > MAX_COVER_BYTES) return; // too large for the page: ignore
    const url = bytes.length ? coverDataUrl(bytes) : null; // empty PICT: no cover
    if (bytes.length && !url) return; // neither JPEG nor PNG
    this.#coverFresh = true;
    this.#set({ coverUrl: url });
  }

  // The position right now, extrapolated from the last report while playing
  #positionNow() {
    const { position, positionAt, playing, duration } = this.#state;
    if (position === null) return null;
    let value = position + (playing && positionAt !== null ? Math.max(0, this.#now() - positionAt) / 1000 : 0);
    if (duration !== null) value = Math.min(value, duration);
    return round(value);
  }

  #pause() {
    const position = this.#positionNow();
    this.#set({ playing: false, position, positionAt: position === null ? null : this.#now() });
  }

  #resume() {
    this.#cancel();
    const patch = { active: true, playing: true };
    // Paused positions are frozen: the clock starts again from now
    if (!this.#state.playing && this.#state.position !== null) patch.positionAt = this.#now();
    this.#set(patch);
  }

  #schedule(ms, action) {
    this.#cancel();
    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      action();
      this.#flush();
    }, ms);
    this.#timer?.unref?.();
  }

  #cancel() {
    if (this.#timer === null) return;
    this.#clearTimer(this.#timer);
    this.#timer = null;
  }

  #set(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (this.#state[key] === value) continue;
      this.#state[key] = value;
      this.#dirty = true;
    }
  }

  #flush() {
    if (!this.#dirty) return;
    this.#dirty = false;
    this.#onChange(this.state);
  }
}

/* ---------- FIFO → chunks ---------- */

// Reads the named pipe without blocking the event loop. It is opened O_RDWR,
// so this process counts as a writer too: shairport-sync may close and reopen
// its end as often as it likes without an end-of-file each time. A missing
// pipe is retried every retryMs and reported once; a pipe that was replaced
// (shairport-sync restarted, /run recreated) is noticed and reopened.
export function createPipeReader({ path, onData, onOpen = () => {}, log = console, retryMs = 10_000 }) {
  let running = false;
  let socket = null;
  let identity = null;
  let retryTimer = null;
  let checkTimer = null;
  let reported = null;

  const report = (key, message) => {
    if (reported === key) return;
    reported = key;
    log.warn(`[music] ${message}`);
  };

  function close() {
    clearInterval(checkTimer);
    checkTimer = null;
    const current = socket;
    socket = null;
    current?.destroy();
  }

  function retry() {
    close();
    if (!running || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, retryMs);
    retryTimer.unref?.();
  }

  function open() {
    if (!running) return;
    let fd;
    try {
      fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    } catch (error) {
      if (error.code === 'ENOENT') report('missing', `${path} fehlt (läuft shairport-sync?), neuer Versuch alle ${retryMs / 1000} s`);
      else report(error.code, `${path} lässt sich nicht öffnen: ${error.message}`);
      return retry();
    }
    let pipe;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFIFO()) throw new Error('ist keine Named Pipe (mkfifo)');
      identity = { dev: stat.dev, ino: stat.ino };
      pipe = new net.Socket({ fd, readable: true, writable: false });
    } catch (error) {
      try {
        fs.closeSync(fd);
      } catch {}
      report('type', `${path} ${error.message}`);
      return retry();
    }
    socket = pipe;
    if (reported) log.log?.(`[music] ${path} ist wieder da`);
    reported = null;
    onOpen();
    pipe.on('data', (chunk) => {
      try {
        onData(chunk);
      } catch (error) {
        log.warn(`[music] ${error.message}`);
      }
    });
    pipe.on('error', (error) => {
      report('read', `${path}: ${error.message}`);
      if (socket === pipe) retry();
    });
    pipe.on('close', () => {
      if (socket === pipe) retry();
    });
    pipe.unref();
    checkTimer = setInterval(() => {
      fs.stat(path, (error, stat) => {
        if (socket !== pipe) return;
        if (!error && stat.dev === identity.dev && stat.ino === identity.ino) return;
        close();
        open();
      });
    }, retryMs);
    checkTimer.unref?.();
  }

  return {
    get connected() {
      return socket !== null;
    },
    start() {
      if (running) return;
      running = true;
      open();
    },
    stop() {
      running = false;
      clearTimeout(retryTimer);
      retryTimer = null;
      close();
    },
  };
}

/* ---------- all together ---------- */

// onChange(state) after every change; state is also readable at any time.
export function createShairportSource({ path = DEFAULT_PIPE, log = console, onChange = () => {}, retryMs, now, setTimer, clearTimer } = {}) {
  const player = new PlayerState({ now, setTimer, clearTimer, onChange });
  const parser = new MetadataParser((item) => {
    try {
      player.handle(item);
    } catch (error) {
      log.warn(`[music] ${item.type}/${item.code}: ${error.message}`);
    }
  });
  const reader = createPipeReader({ path, log, retryMs, onData: (chunk) => parser.push(chunk), onOpen: () => parser.reset() });
  return {
    get state() {
      return player.state;
    },
    get connected() {
      return reader.connected;
    },
    start: () => reader.start(),
    stop() {
      reader.stop();
      player.dispose();
    },
  };
}
