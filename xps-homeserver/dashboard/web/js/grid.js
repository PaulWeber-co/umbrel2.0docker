// Grid arithmetic for edit mode, without any DOM so test/grid.test.js can run
// it in Node: which cells a layout covers, where a tile fits, and the changes
// a user can make (move, swap, resize, remove, add back).
//
// A layout is { tiles: [{ id, col, row, w, h }], hidden: [id] }, the form
// server/layout.js validates. Every function returns a new layout and never
// changes its input; null means "not possible". Results keep the server's
// key order (id, col, row, w, h), so the "layout" event that echoes a save
// compares equal to state.layout in app.js and no rebuild follows.

// Design A: 4 columns × 3 rows (GRID in server/layout.js)
export const COLS = 4;
export const ROWS = 3;

const ID = /^[a-z0-9-]{1,40}$/;

const tilesOf = (layout) => (Array.isArray(layout?.tiles) ? layout.tiles : []).filter((tile) => tile && typeof tile === 'object');
const findTile = (layout, id) => tilesOf(layout).find((tile) => tile.id === id) ?? null;

// A copy in the server's clean form.
export function copyLayout(layout) {
  return {
    tiles: tilesOf(layout).map(({ id, col, row, w, h }) => ({ id, col, row, w, h })),
    hidden: Array.isArray(layout?.hidden) ? [...layout.hidden] : [],
  };
}

function update(layout, id, changes) {
  const next = copyLayout(layout);
  next.tiles = next.tiles.map((tile) => (tile.id === id ? { ...tile, ...changes } : tile));
  return next;
}

// True when { col, row, w, h } lies completely inside the grid.
export const fitsGrid = ({ col, row, w, h } = {}) =>
  [col, row, w, h].every(Number.isInteger) && col >= 0 && row >= 0 && w >= 1 && h >= 1 && col + w <= COLS && row + h <= ROWS;

export const sameSize = (a, b) => Boolean(a && b) && a.w === b.w && a.h === b.h;

// cells[row][col] is the id of the tile covering that cell, or null when free.
export function occupancy(layout) {
  const cells = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (const { id, col, row, w, h } of tilesOf(layout)) {
    if (![col, row, w, h].every(Number.isInteger)) continue;
    for (let r = Math.max(row, 0); r < Math.min(row + h, ROWS); r++) {
      for (let c = Math.max(col, 0); c < Math.min(col + w, COLS); c++) {
        if (cells[r][c] === null) cells[r][c] = String(id);
      }
    }
  }
  return cells;
}

// Whether tile ({ col, row, w, h }) fits on the grid without covering another
// tile. Cells of ignoreId count as free (the tile that is being moved).
export function canPlace(layout, tile, ignoreId) {
  if (!tile || !fitsGrid(tile)) return false;
  const cells = occupancy({ tiles: tilesOf(layout).filter((other) => other.id !== ignoreId) });
  for (let r = tile.row; r < tile.row + tile.h; r++) {
    for (let c = tile.col; c < tile.col + tile.w; c++) {
      if (cells[r][c] !== null) return false;
    }
  }
  return true;
}

// The first spot for a w × h tile, row by row and left to right: { col, row } or null.
export function findFreeSpot(layout, w = 1, h = 1) {
  for (let row = 0; row + h <= ROWS; row++) {
    for (let col = 0; col + w <= COLS; col++) {
      if (canPlace(layout, { col, row, w, h })) return { col, row };
    }
  }
  return null;
}

// Tile id with its size unchanged, its top left corner on (col, row).
export function moveTile(layout, id, col, row) {
  const tile = findTile(layout, id);
  if (!tile || !canPlace(layout, { col, row, w: tile.w, h: tile.h }, id)) return null;
  return update(layout, id, { col, row });
}

// Two tiles trade places; only tiles of the same size, so every widget keeps
// the size its content was made for.
export function swapTiles(layout, idA, idB) {
  const a = findTile(layout, idA);
  const b = findTile(layout, idB);
  if (!a || !b || a === b || !sameSize(a, b)) return null;
  const next = copyLayout(layout);
  next.tiles = next.tiles.map((tile) => {
    if (tile.id === a.id) return { ...tile, col: b.col, row: b.row };
    if (tile.id === b.id) return { ...tile, col: a.col, row: a.row };
    return tile;
  });
  return next;
}

// Toggles the width between 1 and 2: grows to the right when that cell is
// free, else to the left, else null. Shrinking keeps the left cell and always works.
export function resizeTile(layout, id) {
  const tile = findTile(layout, id);
  if (!tile) return null;
  if (tile.w > 1) return update(layout, id, { w: 1 });
  for (const col of [tile.col, tile.col - 1]) {
    if (canPlace(layout, { col, row: tile.row, w: 2, h: tile.h }, id)) return update(layout, id, { col, w: 2 });
  }
  return null;
}

// The tile leaves the grid and is listed under hidden.
export function removeTile(layout, id) {
  if (!findTile(layout, id)) return null;
  const next = copyLayout(layout);
  next.tiles = next.tiles.filter((tile) => tile.id !== id);
  if (!next.hidden.includes(id)) next.hidden.push(id);
  return next;
}

// A hidden widget comes back as a w × h tile on the first free spot; null when there is no room.
export function addTile(layout, id, w = 1, h = 1) {
  if (typeof id !== 'string' || findTile(layout, id)) return null;
  const spot = findFreeSpot(layout, w, h);
  if (!spot) return null;
  const next = copyLayout(layout);
  next.tiles.push({ id, col: spot.col, row: spot.row, w, h });
  next.hidden = next.hidden.filter((other) => other !== id);
  return next;
}

// The rules of validateLayout() in server/layout.js: an error message, or null when valid.
export function validate(layout) {
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.tiles)) return 'Kacheln fehlen';
  const hidden = layout.hidden ?? [];
  if (!Array.isArray(hidden) || hidden.some((id) => typeof id !== 'string')) return 'hidden ist keine Liste von IDs';
  const seen = new Set();
  const taken = new Set();
  for (const tile of layout.tiles) {
    const { id, col, row, w, h } = tile ?? {};
    if (typeof id !== 'string' || !ID.test(id)) return 'ungültige ID';
    if (seen.has(id)) return `${id} doppelt`;
    seen.add(id);
    if (![col, row, w, h].every(Number.isInteger)) return `${id}: keine ganzen Zahlen`;
    if (!fitsGrid({ col, row, w, h })) return `${id} außerhalb des Rasters`;
    for (let c = col; c < col + w; c++) {
      for (let r = row; r < row + h; r++) {
        if (taken.has(`${c},${r}`)) return `${id} überlappt`;
        taken.add(`${c},${r}`);
      }
    }
  }
  return null;
}

/* ---------- pointer → grid, for dragging ---------- */

// The grid cell at stage point (x, y), or null outside the grid. geometry is
// GRID from web/js/layout.js ({ x, y, col, row, gap } in stage pixels); half
// a gap on each side of a cell still counts as that cell.
export function cellAt(x, y, geometry) {
  const { x: left, y: top, col: width, row: height, gap } = geometry;
  const col = Math.floor((x - left + gap / 2) / (width + gap));
  const row = Math.floor((y - top + gap / 2) / (height + gap));
  return col >= 0 && col < COLS && row >= 0 && row < ROWS ? { col, row } : null;
}

// Which cell of tile was grabbed, as an offset from its top left cell.
export function grabOffset(tile, cell) {
  if (!tile || !cell) return { col: 0, row: 0 };
  const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0));
  return { col: clamp(cell.col - tile.col, tile.w - 1), row: clamp(cell.row - tile.row, tile.h - 1) };
}

// Where tile id would go when dropped with the pointer over cell:
//   { type: 'swap', id }        over another tile of the same size
//   { type: 'move', col, row }  over free cells (top left corner, kept inside the grid)
//   null                        anything else, the tile snaps back
// grab keeps the grabbed part of the tile under the pointer.
export function dropTarget(layout, id, cell, grab = { col: 0, row: 0 }) {
  const tile = findTile(layout, id);
  if (!tile || !cell || !fitsGrid({ ...cell, w: 1, h: 1 })) return null;
  const occupant = occupancy(layout)[cell.row][cell.col];
  if (occupant !== null && occupant !== id) {
    return sameSize(tile, findTile(layout, occupant)) ? { type: 'swap', id: occupant } : null;
  }
  const col = Math.min(Math.max(cell.col - grab.col, 0), COLS - tile.w);
  const row = Math.min(Math.max(cell.row - grab.row, 0), ROWS - tile.h);
  if (col === tile.col && row === tile.row) return null;
  return canPlace(layout, { col, row, w: tile.w, h: tile.h }, id) ? { type: 'move', col, row } : null;
}
