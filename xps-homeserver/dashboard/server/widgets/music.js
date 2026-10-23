// Music mode. No tile of its own: while something plays on the XPS speakers
// the front end (web/js/features/music.js) shows the player under the clock.
// Two receivers feed it:
//   AirPlay   shairport-sync, metadata through a pipe (server/sources/shairport.js)
//   Spotify   go-librespot as a Spotify Connect speaker, asked over its local
//             API (server/sources/spotify.js)
// Whichever plays is shown, with `via` saying which ("airplay", "spotify");
// if both claim to, the one that started last.
//
// Settings:
//   DASH_SHAIRPORT_PIPE   metadata pipe of shairport-sync, default
//                         /run/shairport-sync/metadata
//   DASH_SPOTIFY_URL      go-librespot's API, default http://127.0.0.1:3678;
//                         "off" leaves Spotify out
//   DASH_DEMO_MUSIC       "1" (AirPlay) or "spotify": in demo mode a sample
//                         track plays
//
// Both sources push, so watch() publishes every change at once; fetch() only
// repeats the current state. Without the receivers the state stays inactive.
import { createShairportSource, DEFAULT_PIPE, inactiveState } from '../sources/shairport.js';
import { createSpotifySource, DEFAULT_URL as SPOTIFY_URL } from '../sources/spotify.js';

// Of both receivers' states the one to show: the playing one, else the
// active one; with both playing (or both paused) the one active since later
export function pickState(airplay, spotify, since = {}) {
  const tagged = [
    { ...(airplay ?? inactiveState()), via: 'airplay' },
    { ...(spotify ?? inactiveState()), via: 'spotify' },
  ];
  const active = tagged.filter((state) => state.active);
  if (!active.length) return { ...inactiveState(), via: null };
  active.sort((a, b) => Number(b.playing) - Number(a.playing) || (since[b.via] ?? 0) - (since[a.via] ?? 0));
  return active[0];
}

// The running source per hub context, so fetch() can read its state
const sources = new WeakMap();

// Sample cover drawn as SVG: warm gradient with soft light spots, an arc and a
// horizon line, like the covers in the design mockup.
const DEMO_COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#7b2d5b"/></linearGradient>
<radialGradient id="a" cx="150" cy="170" r="300" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffc46b"/><stop offset="1" stop-color="#ffc46b" stop-opacity="0"/></radialGradient>
<radialGradient id="b" cx="470" cy="400" r="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#c2386f"/><stop offset="1" stop-color="#c2386f" stop-opacity="0"/></radialGradient>
<radialGradient id="c" cx="300" cy="560" r="220" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffe2b0"/><stop offset="1" stop-color="#ffe2b0" stop-opacity="0"/></radialGradient>
</defs>
<rect width="600" height="600" fill="url(#bg)"/>
<rect width="600" height="600" fill="url(#a)"/>
<rect width="600" height="600" fill="url(#b)"/>
<rect width="600" height="600" fill="url(#c)"/>
<g fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2">
<path d="M151.8 276.5A150 150 0 0 1 448.2 276.5"/>
<path d="M70 452H530"/>
</g>
</svg>`;
export const DEMO_COVER = `data:image/svg+xml;base64,${Buffer.from(DEMO_COVER_SVG).toString('base64')}`;

const DEMO_TRACK = { title: 'Weites Land', artist: 'Beispiel-Künstlerin', album: 'Demo-Album', source: 'Pauls iPhone', duration: 222 };

const demoEnabled = (config) => typeof config?.get === 'function' && ['1', 'spotify'].includes(config.get('DASH_DEMO_MUSIC', '0'));

export default {
  id: 'music',
  tile: false, // drives music mode, has no tile and no module in web/js/widgets/
  intervalMs: 30_000,
  isConfigured: () => true,

  watch(ctx, emit) {
    const states = { airplay: inactiveState(), spotify: inactiveState() };
    const since = {};
    let shown = null;
    const update = (via, state) => {
      if (state.active && !states[via].active) since[via] = Date.now();
      states[via] = state;
      shown = pickState(states.airplay, states.spotify, since);
      emit(shown);
    };
    const airplay = createShairportSource({
      path: ctx.config.get('DASH_SHAIRPORT_PIPE', DEFAULT_PIPE),
      log: ctx.log,
      onChange: (state) => update('airplay', state),
    });
    const spotifyUrl = ctx.config.get('DASH_SPOTIFY_URL', SPOTIFY_URL);
    const spotify =
      spotifyUrl === 'off'
        ? null
        : createSpotifySource({ url: spotifyUrl, fetchImpl: ctx.fetchImpl ?? globalThis.fetch, log: ctx.log, onChange: (state) => update('spotify', state) });
    const running = { get state() { return shown ?? pickState(states.airplay, states.spotify, since); } };
    sources.set(ctx, running);
    airplay.start();
    spotify?.start();
    return () => {
      airplay.stop();
      spotify?.stop();
      if (sources.get(ctx) === running) sources.delete(ctx);
    };
  },

  fetch(ctx) {
    return sources.get(ctx)?.state ?? { ...inactiveState(), via: null };
  },

  // Inactive unless DASH_DEMO_MUSIC is set; then the sample track plays in a loop,
  // its position follows the clock.
  demo({ config, now } = {}) {
    if (!demoEnabled(config)) return { ...inactiveState(), via: null };
    const spotify = config.get('DASH_DEMO_MUSIC') === 'spotify';
    const at = (now?.() ?? new Date()).getTime();
    const position = Math.round(((at / 1000 + 48) % DEMO_TRACK.duration) * 1000) / 1000;
    return {
      active: true,
      playing: true,
      title: DEMO_TRACK.title,
      artist: DEMO_TRACK.artist,
      album: DEMO_TRACK.album,
      source: spotify ? 'Spotify' : DEMO_TRACK.source,
      via: spotify ? 'spotify' : 'airplay',
      coverUrl: DEMO_COVER,
      position,
      duration: DEMO_TRACK.duration,
      positionAt: at,
      volume: 0.6,
    };
  },
};
