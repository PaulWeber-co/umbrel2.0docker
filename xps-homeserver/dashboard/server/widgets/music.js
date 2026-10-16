// AirPlay music mode. No tile of its own: while something plays on the XPS
// speakers (shairport-sync, see server/sources/shairport.js) the front end
// (web/js/music.js) moves the tiles aside and shows the player.
//
// Settings:
//   DASH_SHAIRPORT_PIPE   metadata pipe of shairport-sync, default
//                         /run/shairport-sync/metadata
//   DASH_DEMO_MUSIC       "1": in demo mode a sample track plays
//
// The pipe pushes, so watch() publishes every change at once; fetch() only
// repeats the current state. Without shairport-sync the state stays inactive.
import { createShairportSource, DEFAULT_PIPE, inactiveState } from '../sources/shairport.js';

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

const demoEnabled = (config) => typeof config?.get === 'function' && config.get('DASH_DEMO_MUSIC', '0') === '1';

export default {
  id: 'music',
  tile: false, // drives music mode, has no tile and no module in web/js/widgets/
  intervalMs: 30_000,
  isConfigured: () => true,

  watch(ctx, emit) {
    const source = createShairportSource({
      path: ctx.config.get('DASH_SHAIRPORT_PIPE', DEFAULT_PIPE),
      log: ctx.log,
      onChange: (state) => emit(state),
    });
    sources.set(ctx, source);
    source.start();
    return () => {
      source.stop();
      if (sources.get(ctx) === source) sources.delete(ctx);
    };
  },

  fetch(ctx) {
    return sources.get(ctx)?.state ?? inactiveState();
  },

  // Inactive unless DASH_DEMO_MUSIC=1; then the sample track plays in a loop,
  // its position follows the clock.
  demo({ config, now } = {}) {
    if (!demoEnabled(config)) return inactiveState();
    const at = (now?.() ?? new Date()).getTime();
    const position = Math.round(((at / 1000 + 48) % DEMO_TRACK.duration) * 1000) / 1000;
    return {
      active: true,
      playing: true,
      title: DEMO_TRACK.title,
      artist: DEMO_TRACK.artist,
      album: DEMO_TRACK.album,
      source: DEMO_TRACK.source,
      coverUrl: DEMO_COVER,
      position,
      duration: DEMO_TRACK.duration,
      positionAt: at,
      volume: 0.6,
    };
  },
};
