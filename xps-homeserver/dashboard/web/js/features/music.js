// Music mode: while AirPlay plays (server/widgets/music.js, data from
// shairport-sync) the player pops up in the free space under the clock:
// title, artist and a smoothly running progress bar flush above the cover,
// and the background glows in the cover's colour. The tiles never move.
// Edit mode pauses music mode until it ends.
//
// progressAt, formatTime and averageColour are pure and run in Node for the
// tests; the DOM is only touched inside init().
import { $ } from '../util.js';

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

  el.cover?.addEventListener('load', paintGlow);
  el.cover?.addEventListener('error', () => {
    if (coverSrc !== PLACEHOLDER) setCover(null);
  });
  // Edit mode arranges the normal grid: music mode waits until it is done.
  // data-musicmode="0": switched off in the control center (features/display.js)
  new MutationObserver(() => safely(apply)).observe(stage, { attributes: true, attributeFilter: ['data-edit', 'data-musicmode'] });
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
    el.title?.classList.toggle('long', title.length > 22);
    setText(el.artist, [data.artist, data.album].filter(Boolean).join(' · '));
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
    const next = Boolean(data?.active) && stage.dataset.edit !== '1' && stage.dataset.musicmode !== '0';
    if (next !== shown) {
      shown = next;
      stage.dataset.music = shown ? '1' : '0';
      // Without an animation on the first state after loading
      stage.classList.toggle('no-anim', first);
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
