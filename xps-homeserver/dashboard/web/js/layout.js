// Places tiles on the 1920×1080 stage and animates every change with FLIP:
// measure where a tile was, move it, then animate the difference with a
// transform only, which the Skylake GPU handles without re-layout per frame.

// Grid of design A: 4 columns × 3 rows to the right of the clock.
export const GRID = { x: 760, y: 80, col: 248, row: 290, gap: 24 };

export function rectFor({ col, row, w, h }) {
  return [
    GRID.x + col * (GRID.col + GRID.gap),
    GRID.y + row * (GRID.row + GRID.gap),
    w * GRID.col + (w - 1) * GRID.gap,
    h * GRID.row + (h - 1) * GRID.gap,
  ];
}

// rects: Map of tile id → [x, y, w, h], or null to hide the tile.
// scale: the stage's current CSS scale, needed to turn screen pixels into stage pixels.
export function applyRects(tiles, rects, { animate = true, scale = 1 } = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = new Map(tiles.map((el) => [el, el.getBoundingClientRect()]));
  for (const el of tiles) {
    el.style.transform = '';
    const rect = rects.get(el.dataset.id);
    if (!rect) {
      el.classList.add('gone');
      continue;
    }
    Object.assign(el.style, { left: `${rect[0]}px`, top: `${rect[1]}px`, width: `${rect[2]}px`, height: `${rect[3]}px` });
    el.classList.remove('gone');
  }
  if (!animate || reduce) return;
  for (const el of tiles) {
    if (el.classList.contains('gone')) continue;
    const a = before.get(el);
    const b = el.getBoundingClientRect();
    if (!a.width || !b.width) continue;
    const dx = (a.left - b.left) / scale;
    const dy = (a.top - b.top) / scale;
    const sx = a.width / b.width;
    const sy = a.height / b.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    el.animate(
      [
        { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: 760, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    );
  }
}

// The layout from the server as rects for normal mode.
export function normalRects(layout) {
  const rects = new Map(layout.tiles.map((tile) => [tile.id, rectFor(tile)]));
  for (const id of layout.hidden ?? []) rects.set(id, null);
  return rects;
}
