// Music mode: while AirPlay plays (server/widgets/music.js, data from
// shairport-sync) the tiles glide into a narrow column on the right, the
// player with cover, title, artist, album and a smoothly running progress bar
// appears bottom left, and the background glows in the cover's colour. The
// clock header never moves. Edit mode pauses music mode until it ends.
//
// musicRects, progressAt, formatTime and averageColour are pure and run in
// Node for the tests; the DOM is only touched inside init().
import { $ } from './util.js';

/* ---------- layout ---------- */

// The narrow column on the 1920×1080 stage: [x, y, w, h]
export const SLOTS = {
  wide: [
    [1336, 80, 488, 290],
    [1336, 708, 488, 290],
  ],
  small: [
    [1336, 394, 232, 290],
    [1592, 394, 232, 290],
  ],
};
const PREFERRED = { wide: ['wetter', 'server'], small: ['weg', 'home'] };
const FITS = { wide: (tile) => tile.w >= 2, small: (tile) => tile.w === 1 && tile.h === 1 };

// Layout → Map id → [x, y, w, h] | null. Four tiles stay: two wide ones
// (preferably weather and server) and two small ones (preferably commute and
// home), every other tile is hidden.
export function musicRects(layout) {
  const hidden = new Set(layout?.hidden ?? []);
  const tiles = (layout?.tiles ?? []).filter((tile) => !hidden.has(tile.id));
  const rects = new Map((layout?.tiles ?? []).map((tile) => [tile.id, null]));
  for (const id of hidden) rects.set(id, null);
  const taken = new Set();
  for (const kind of ['wide', 'small']) {
    const fitting = tiles.filter((tile) => FITS[kind](tile) && !taken.has(tile.id));
    const ranked = [
      ...PREFERRED[kind].map((id) => fitting.find((tile) => tile.id === id)).filter(Boolean),
      ...fitting.filter((tile) => !PREFERRED[kind].includes(tile.id)),
    ];
    SLOTS[kind].forEach((slot, i) => {
      if (!ranked[i]) return;
      rects.set(ranked[i].id, [...slot]);
      taken.add(ranked[i].id);
    });
  }
  return rects;
}

/* ---------- progress ---------- */

// Seconds into the track at nowMs: the server's position plus the time since
// it was measured while playing, never beyond the end; null when unknown.
export function progressAt(data, nowMs) {
  if (typeof data?.position !== 'number') return null;
  let position = data.position;
  if (data.playing && typeof data.positionAt === 'number') position += Math.max(0, nowMs - data.positionAt) / 1000;
  if (typeof data.duration === 'number') position = Math.min(position, data.duration);
  return Math.max(0, position);
}

// 222 → "3:42"
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------- glow colour ---------- */

// Dominant colour of RGBA pixels (a 24×24 thumbnail): the average, weighted
// towards saturated pixels, brightened so the glow never turns muddy. Taken
// from the design mockup. null when every pixel is transparent.
export function averageColour(pixels) {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
    const weight = ((max - min) / 255 + 0.04) * (pixels[i + 3] / 255);
    r += pixels[i] * weight;
    g += pixels[i + 1] * weight;
    b += pixels[i + 2] * weight;
    total += weight;
  }
  return total > 0 ? brighten([r / total, g / total, b / total]) : null;
}

export function brighten([r, g, b]) {
  const k = 225 / (Math.max(r, g, b) || 1);
  return [r, g, b].map((v) => Math.round(Math.min(255, v * k)));
}

// Shown when the track has no cover: a note on a quiet grey-blue gradient
const PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 440">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b6675"/><stop offset="1" stop-color="#262c35"/></linearGradient></defs>' +
    '<rect width="440" height="440" fill="url(#g)"/>' +
    '<g transform="translate(130 130) scale(7.5)" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></g></svg>',
)}`;

/* ---------- the feature ---------- */

export function init(ctx) {
  const { stage } = ctx;
  const el = {
    player: $('#player'),
    cover: $('#cover'),
    title: $('#ptitle'),
    artist: $('#partist'),
    album: $('#palbum'),
    bar: $('#pbar'),
    pos: $('#ppos'),
    dur: $('#pdur'),
    night: $('#ntitle'), // optional: the "♪ title" line of the night view
  };
  const prog = el.bar?.closest('.prog') ?? null;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

  let data = null; // latest state from the server
  let shown = false; // music mode on screen
  let first = true; // the first state after loading: no glide
  let coverSrc = null;
  let frame = 0;
  let timer = 0;
  let lastSecond = null;

  const setText = (node, text) => {
    if (node && node.textContent !== text) node.textContent = text;
  };
  const resetGlow = () => stage.style.removeProperty('--glow');

  ctx.setRectsProvider((layout) => (shown ? musicRects(layout) : null));

  el.cover?.addEventListener('load', paintGlow);
  el.cover?.addEventListener('error', () => {
    if (coverSrc !== PLACEHOLDER) setCover(null);
  });
  // Edit mode arranges the normal grid: music mode waits until it is done
  new MutationObserver(() => safely(apply)).observe(stage, { attributes: true, attributeFilter: ['data-edit'] });
  reducedMotion?.addEventListener?.('change', () => safely(apply));

  ctx.onEntry('music', (entry) => safely(() => update(entry)));

  function safely(run) {
    try {
      run();
    } catch (error) {
      console.error('Musik-Modus:', error);
    }
  }

  function update(entry) {
    data = entry?.data ?? null;
    if (data?.active) fill();
    apply();
  }

  // Texts, cover and the static parts of the progress display
  function fill() {
    const title = data.title || 'AirPlay';
    setText(el.title, title);
    el.title?.classList.toggle('long', title.length > 28);
    setText(el.artist, data.artist ?? '');
    setText(el.album, data.album ?? '');
    setText(el.night, title);
    el.player?.classList.toggle('is-paused', !data.playing);
    setCover(data.coverUrl);
    const hasDuration = typeof data.duration === 'number' && data.duration > 0;
    prog?.classList.toggle('no-dur', !hasDuration);
    prog?.classList.toggle('no-pos', typeof data.position !== 'number');
    if (hasDuration) setText(el.dur, formatTime(data.duration));
    lastSecond = null;
    draw();
  }

  function setCover(url) {
    // Only images the server embedded, never a remote address
    const src = typeof url === 'string' && url.startsWith('data:image/') ? url : PLACEHOLDER;
    if (src === coverSrc) return;
    coverSrc = src;
    if (src === PLACEHOLDER) resetGlow();
    if (el.cover) el.cover.src = src; // the load event paints the glow
  }

  function paintGlow() {
    if (!el.cover || coverSrc === PLACEHOLDER) return resetGlow();
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 24;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(el.cover, 0, 0, 24, 24);
      const rgb = averageColour(g.getImageData(0, 0, 24, 24).data);
      if (rgb) stage.style.setProperty('--glow', rgb.join(' '));
      else resetGlow();
    } catch {
      resetGlow(); // e.g. a canvas the browser considers tainted
    }
  }

  // Music mode on or off, then the progress loop
  function apply() {
    const next = Boolean(data?.active) && stage.dataset.edit !== '1';
    if (next !== shown) {
      shown = next;
      stage.dataset.music = shown ? '1' : '0';
      for (const tile of ctx.state.layout?.tiles ?? []) ctx.renderTile(tile.id); // compact or not
      ctx.relayout(!first);
    }
    first = false;
    startLoop();
  }

  function draw() {
    const position = progressAt(data, Date.now());
    if (position === null) return null;
    if (el.bar && typeof data.duration === 'number' && data.duration > 0) {
      el.bar.style.transform = `scaleX(${(position / data.duration).toFixed(4)})`;
    }
    const second = Math.floor(position);
    if (second !== lastSecond) {
      lastSecond = second;
      setText(el.pos, formatTime(position));
    }
    return position;
  }

  function stopLoop() {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = 0;
    timer = 0;
  }

  // Every frame while playing; once a second with reduced motion or at night,
  // when the player is not visible anyway. Paused: drawn once, no loop.
  function startLoop() {
    stopLoop();
    if (!shown || !data?.playing || typeof data.position !== 'number') return;
    const tick = () => {
      frame = 0;
      timer = 0;
      const position = draw();
      // At the end nothing moves until the next track's data arrives
      if (position === null || (typeof data.duration === 'number' && position >= data.duration)) return;
      if (reducedMotion?.matches || stage.dataset.scene === 'nacht') {
        timer = setTimeout(tick, Math.ceil((1 - (position % 1)) * 1000) + 20);
      } else {
        frame = requestAnimationFrame(tick);
      }
    };
    tick();
  }
}
