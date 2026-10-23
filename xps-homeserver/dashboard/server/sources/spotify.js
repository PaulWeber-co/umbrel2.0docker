// Spotify Connect: go-librespot (deploy/airplay/compose.yaml) makes the XPS a
// speaker in the Spotify app, next to AirPlay. Its API server on
// 127.0.0.1:3678 tells what plays:
//
//   GET /status → { stopped, paused, buffering, volume, volume_steps,
//                   track: { name, artist_names, album_name, album_cover_url,
//                            position, duration } }   (ms), or 204 without a session
//
// createSpotifySource() asks every 2 s while something plays and every 5 s
// otherwise, and turns the answer into the music widget's state (see
// inactiveState() in shairport.js). It only reports a change when something
// besides the running position changed, or the position jumped (a seek): the
// browsers run the progress bar on their own. Covers come from Spotify's image
// CDN and are fetched here, once per track, and passed on as a data URL, since
// the page loads nothing from elsewhere.
//
// toState() and sameState() are pure and tested on their own.
import { networkReason } from '../hub.js';
import { coverDataUrl, END_DELAY_MS, inactiveState, MAX_COVER_BYTES, PAUSE_TIMEOUT_MS } from './shairport.js';

export const DEFAULT_URL = 'http://127.0.0.1:3678';
export const ACTIVE_POLL_MS = 2000;
export const IDLE_POLL_MS = 5000;
const SEEK_TOLERANCE_S = 2;
const COVER_HOST = /(^|\.)(scdn\.co|spotifycdn\.com)$/i;

const round = (value) => Math.round(value * 1000) / 1000;

// A /status answer → the widget's state, or null when nothing is loaded
export function toState(status, now, cover = null) {
  const track = status?.track;
  if (!track || status.stopped || typeof track.name !== 'string') return null;
  const steps = Number(status.volume_steps);
  const duration = Number(track.duration) > 0 ? round(Number(track.duration) / 1000) : null;
  return {
    ...inactiveState(),
    active: true,
    playing: !status.paused && !status.buffering,
    title: track.name.slice(0, 300),
    artist: (Array.isArray(track.artist_names) ? track.artist_names : []).filter((name) => typeof name === 'string').join(', ').slice(0, 300),
    album: String(track.album_name ?? '').slice(0, 300),
    source: 'Spotify',
    coverUrl: cover,
    position: Number.isFinite(Number(track.position)) ? round(Math.max(0, Number(track.position)) / 1000) : null,
    duration,
    positionAt: now,
    volume: steps > 0 && Number.isFinite(Number(status.volume)) ? round(Math.min(1, Math.max(0, Number(status.volume) / steps))) : null,
  };
}

// Where the position of a state is at `now`
const positionAt = (state, now) => (typeof state.position === 'number' ? state.position + (state.playing && typeof state.positionAt === 'number' ? (now - state.positionAt) / 1000 : 0) : null);

// Nothing worth telling the browsers: the same apart from the running position
export function sameState(a, b, now) {
  if (!a || !b) return a === b;
  for (const key of ['active', 'playing', 'title', 'artist', 'album', 'source', 'coverUrl', 'duration', 'volume']) {
    if (a[key] !== b[key]) return false;
  }
  const pa = positionAt(a, now);
  const pb = positionAt(b, now);
  if (pa === null || pb === null) return pa === pb;
  return Math.abs(pa - pb) < SEEK_TOLERANCE_S;
}

export function coverAllowed(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && COVER_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function createSpotifySource({
  url = DEFAULT_URL,
  fetchImpl = globalThis.fetch,
  log = console,
  onChange = () => {},
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const base = String(url).replace(/\/+$/, '');
  let state = inactiveState();
  let timer = null;
  let running = false;
  let quiet = false; // the "not reachable" warning is logged once
  let endSince = null; // nothing loaded since …
  let pausedSince = null;
  const cover = { url: null, data: null }; // the last cover fetched

  const publish = (next) => {
    if (sameState(state, next, now())) return;
    state = next;
    onChange({ ...state });
  };

  async function loadCover(coverUrl) {
    let data = null;
    try {
      const response = await fetchImpl(coverUrl, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Cover: HTTP ${response.status}`);
      if (Number(response.headers?.get?.('content-length')) > MAX_COVER_BYTES) throw new Error('Cover zu groß');
      data = coverDataUrl(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      log.warn?.(`[spotify] ${error.message}`);
    }
    Object.assign(cover, { url: coverUrl, data });
  }

  async function poll() {
    let status = null;
    try {
      const response = await fetchImpl(`${base}/status`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
      if (response.status === 200) status = await response.json();
      else if (response.status !== 204) throw new Error(`/status: HTTP ${response.status}`);
      quiet = false;
    } catch (error) {
      // Switched off in the control center, or still starting: no Spotify
      if (!quiet) log.warn?.(`[spotify] go-librespot unter ${base} nicht erreichbar: ${networkReason(error)} – normal, solange der Lautsprecher aus ist oder startet`);
      quiet = true;
    }
    const t = now();
    const loaded = toState(status, t);
    if (!loaded) {
      pausedSince = null;
      endSince ??= t;
      // A moment between two tracks is not the end yet
      if (!state.active || t - endSince >= END_DELAY_MS) publish(inactiveState());
      return;
    }
    endSince = null;
    pausedSince = loaded.playing ? null : (pausedSince ?? t);
    // Paused for long: back to the normal dashboard, like AirPlay
    if (pausedSince !== null && t - pausedSince >= PAUSE_TIMEOUT_MS) {
      publish(inactiveState());
      return;
    }
    // The track shows at once, its cover follows as soon as it is here
    const coverUrl = coverAllowed(status.track.album_cover_url) ? status.track.album_cover_url : null;
    publish({ ...loaded, coverUrl: coverUrl && cover.url === coverUrl ? cover.data : null });
    if (coverUrl && cover.url !== coverUrl) {
      await loadCover(coverUrl);
      if (state.active && state.title === loaded.title && cover.url === coverUrl) publish({ ...state, coverUrl: cover.data });
    }
  }

  async function loop() {
    if (!running) return;
    await poll().catch((error) => log.warn?.(`[spotify] ${error.message}`));
    if (!running) return;
    timer = setTimer(loop, state.active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    timer?.unref?.();
  }

  return {
    get state() {
      return { ...state };
    },
    poll,
    start() {
      if (running) return;
      running = true;
      loop();
    },
    stop() {
      running = false;
      clearTimer(timer);
    },
  };
}
