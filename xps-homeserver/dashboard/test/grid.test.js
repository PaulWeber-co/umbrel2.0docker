// Grid arithmetic of edit mode (web/js/grid.js): every change, its edge cases,
// that inputs stay untouched, and that validate() agrees with the server's
// validateLayout() in server/layout.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LAYOUT, GRID as SERVER_GRID, validateLayout } from '../server/layout.js';
import {
  addTile,
  canPlace,
  cellAt,
  COLS,
  copyLayout,
  dropTarget,
  findFreeSpot,
  grabOffset,
  moveTile,
  occupancy,
  removeTile,
  resizeTile,
  ROWS,
  swapTiles,
  validate,
} from '../web/js/grid.js';
import { GRID, rectFor } from '../web/js/layout.js';

const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
// A full grid in the shape the tests below rely on (row 1: kal kal server server,
// row 2: todo todo home dienste), independent of DEFAULT_LAYOUT
const FULL = {
  tiles: [
    { id: 'wetter', col: 0, row: 0, w: 2, h: 1 },
    { id: 'weg', col: 2, row: 0, w: 1, h: 1 },
    { id: 'fotos', col: 3, row: 0, w: 1, h: 1 },
    { id: 'kal', col: 0, row: 1, w: 2, h: 1 },
    { id: 'server', col: 2, row: 1, w: 2, h: 1 },
    { id: 'todo', col: 0, row: 2, w: 2, h: 1 },
    { id: 'home', col: 2, row: 2, w: 1, h: 1 },
    { id: 'dienste', col: 3, row: 2, w: 1, h: 1 },
  ],
  hidden: [],
};
const full = () => deepFreeze(structuredClone(FULL));
const at = (layout, id) => layout.tiles.find((tile) => tile.id === id);
// The form the server stores and echoes over /api/events (see server/http.js)
const serverClean = (layout) => ({ tiles: layout.tiles.map(({ id, col, row, w, h }) => ({ id, col, row, w, h })), hidden: layout.hidden ?? [] });

// Row 0: wetter wetter weg · | row 1: kal kal · · | row 2: todo todo · dienste
const sparse = () =>
  deepFreeze({
    tiles: [
      { id: 'wetter', col: 0, row: 0, w: 2, h: 1 },
      { id: 'weg', col: 2, row: 0, w: 1, h: 1 },
      { id: 'kal', col: 0, row: 1, w: 2, h: 1 },
      { id: 'todo', col: 0, row: 2, w: 2, h: 1 },
      { id: 'dienste', col: 3, row: 2, w: 1, h: 1 },
    ],
    hidden: ['fotos', 'server', 'home'],
  });

test('the default layout is valid and fills the grid', () => {
  assert.equal(validate(DEFAULT_LAYOUT), null);
  assert.ok(occupancy(DEFAULT_LAYOUT).flat().every((id) => id !== null));
});

test('grid size matches the server', () => {
  assert.equal(COLS, SERVER_GRID.cols);
  assert.equal(ROWS, SERVER_GRID.rows);
});

test('occupancy maps every cell to its tile', () => {
  const cells = occupancy(full());
  assert.equal(cells.length, 3);
  assert.deepEqual(cells[0], ['wetter', 'wetter', 'weg', 'fotos']);
  assert.deepEqual(cells[2], ['todo', 'todo', 'home', 'dienste']);
  assert.ok(cells.flat().every((id) => id !== null), 'default layout fills the grid');
  const holes = occupancy(sparse());
  assert.deepEqual(holes[0], ['wetter', 'wetter', 'weg', null]);
  assert.deepEqual(holes[1], ['kal', 'kal', null, null]);
  assert.deepEqual(occupancy({ tiles: [] }).flat(), Array(12).fill(null));
  assert.deepEqual(occupancy(null).flat(), Array(12).fill(null));
});

test('canPlace checks bounds, overlap and the ignored tile', () => {
  const layout = sparse();
  assert.equal(canPlace(layout, { col: 2, row: 1, w: 2, h: 1 }), true);
  assert.equal(canPlace(layout, { col: 3, row: 0, w: 1, h: 1 }), true);
  assert.equal(canPlace(layout, { col: 2, row: 0, w: 2, h: 1 }), false, 'covers weg');
  assert.equal(canPlace(layout, { col: 2, row: 0, w: 2, h: 1 }, 'weg'), true, 'weg ignored');
  assert.equal(canPlace(layout, { col: 3, row: 1, w: 2, h: 1 }), false, 'past the right edge');
  assert.equal(canPlace(layout, { col: 2, row: 2, w: 1, h: 2 }), false, 'past the bottom');
  assert.equal(canPlace(layout, { col: -1, row: 1, w: 1, h: 1 }), false);
  assert.equal(canPlace(layout, { col: 2.5, row: 1, w: 1, h: 1 }), false);
  assert.equal(canPlace(layout, null), false);
  assert.equal(canPlace(full(), { col: 0, row: 0, w: 1, h: 1 }), false, 'full grid');
});

test('findFreeSpot scans rows first, then columns', () => {
  assert.equal(findFreeSpot(full()), null, 'full grid');
  const layout = sparse();
  assert.deepEqual(findFreeSpot(layout), { col: 3, row: 0 }, 'row 0 comes before column 2 of row 1');
  assert.deepEqual(findFreeSpot(layout, 2, 1), { col: 2, row: 1 });
  assert.equal(findFreeSpot(layout, 3, 1), null);
  assert.equal(findFreeSpot(layout, 5, 1), null, 'wider than the grid');
  assert.deepEqual(findFreeSpot({ tiles: [] }, 4, 3), { col: 0, row: 0 });
});

test('moveTile moves into free cells only', () => {
  const layout = sparse();
  const moved = moveTile(layout, 'weg', 3, 1);
  assert.deepEqual(at(moved, 'weg'), { id: 'weg', col: 3, row: 1, w: 1, h: 1 });
  assert.deepEqual(at(moved, 'wetter'), at(layout, 'wetter'));
  assert.equal(moveTile(layout, 'weg', 0, 1), null, 'onto kal');
  assert.equal(moveTile(layout, 'kal', 3, 1), null, 'a wide tile past the right edge');
  assert.equal(moveTile(layout, 'weg', 4, 0), null);
  assert.equal(moveTile(layout, 'nope', 3, 0), null, 'unknown id');
  assert.equal(moveTile(full(), 'weg', 3, 0), null, 'full grid');
  // A wide tile may slide over its own cells
  assert.deepEqual(at(moveTile(layout, 'kal', 1, 1), 'kal'), { id: 'kal', col: 1, row: 1, w: 2, h: 1 });
});

test('swapTiles swaps tiles of the same size and refuses others', () => {
  const layout = full();
  const swapped = swapTiles(layout, 'wetter', 'server');
  assert.deepEqual(at(swapped, 'wetter'), { id: 'wetter', col: 2, row: 1, w: 2, h: 1 });
  assert.deepEqual(at(swapped, 'server'), { id: 'server', col: 0, row: 0, w: 2, h: 1 });
  assert.equal(validateLayout(swapped), null);
  const small = swapTiles(layout, 'weg', 'dienste');
  assert.deepEqual([at(small, 'weg').col, at(small, 'weg').row, at(small, 'dienste').col, at(small, 'dienste').row], [3, 2, 2, 0]);
  assert.equal(swapTiles(layout, 'wetter', 'weg'), null, 'different sizes');
  assert.equal(swapTiles(layout, 'weg', 'weg'), null, 'with itself');
  assert.equal(swapTiles(layout, 'weg', 'nope'), null, 'unknown id');
});

test('resizeTile grows right, then left, and always shrinks', () => {
  const layout = sparse();
  // weg at column 2, column 3 free → grows to the right
  assert.deepEqual(at(resizeTile(layout, 'weg'), 'weg'), { id: 'weg', col: 2, row: 0, w: 2, h: 1 });
  // dc at the right edge, column 2 of row 2 free → grows to the left
  assert.deepEqual(at(resizeTile(layout, 'dienste'), 'dienste'), { id: 'dienste', col: 2, row: 2, w: 2, h: 1 });
  // right side blocked, left side free: · a b ·
  const blockedRight = deepFreeze({ tiles: [{ id: 'a', col: 1, row: 0, w: 1, h: 1 }, { id: 'b', col: 2, row: 0, w: 1, h: 1 }], hidden: [] });
  assert.deepEqual(at(resizeTile(blockedRight, 'a'), 'a'), { id: 'a', col: 0, row: 0, w: 2, h: 1 });
  assert.deepEqual(at(resizeTile(blockedRight, 'b'), 'b'), { id: 'b', col: 2, row: 0, w: 2, h: 1 }, 'right side preferred');
  // both sides blocked: kal kal weg dienste
  const blockedBoth = moveTile(moveTile(layout, 'dienste', 3, 1), 'weg', 2, 1);
  assert.equal(resizeTile(blockedBoth, 'weg'), null);
  // no room on either side
  assert.equal(resizeTile(full(), 'weg'), null);
  assert.equal(resizeTile(full(), 'dienste'), null, 'right edge, left side taken');
  const leftEdge = { tiles: [{ id: 'a', col: 0, row: 0, w: 1, h: 1 }, { id: 'b', col: 1, row: 0, w: 1, h: 1 }], hidden: [] };
  assert.equal(resizeTile(leftEdge, 'a'), null, 'left edge, right side taken');
  // shrinking keeps the left cell, even on a full grid
  assert.deepEqual(at(resizeTile(full(), 'wetter'), 'wetter'), { id: 'wetter', col: 0, row: 0, w: 1, h: 1 });
  assert.deepEqual(at(resizeTile(full(), 'server'), 'server'), { id: 'server', col: 2, row: 1, w: 1, h: 1 });
  assert.equal(resizeTile(layout, 'nope'), null);
});

test('removeTile hides the tile', () => {
  const removed = removeTile(full(), 'fotos');
  assert.equal(at(removed, 'fotos'), undefined);
  assert.deepEqual(removed.hidden, ['fotos']);
  assert.equal(removed.tiles.length, 7);
  assert.equal(occupancy(removed)[0][3], null);
  assert.equal(removeTile(removed, 'fotos'), null, 'already hidden');
  const already = removeTile({ tiles: [{ id: 'x', col: 0, row: 0, w: 1, h: 1 }], hidden: ['x'] }, 'x');
  assert.deepEqual(already.hidden, ['x'], 'not listed twice');
});

test('addTile brings a hidden widget back on the first free spot', () => {
  const layout = sparse();
  const fotos = addTile(layout, 'fotos', 1, 1);
  assert.deepEqual(at(fotos, 'fotos'), { id: 'fotos', col: 3, row: 0, w: 1, h: 1 });
  assert.deepEqual(fotos.hidden, ['server', 'home']);
  const server = addTile(layout, 'server', 2, 1);
  assert.deepEqual(at(server, 'server'), { id: 'server', col: 2, row: 1, w: 2, h: 1 });
  assert.deepEqual(at(addTile(layout, 'home'), 'home'), { id: 'home', col: 3, row: 0, w: 1, h: 1 }, 'default size 1×1');
  assert.equal(addTile(full(), 'extra', 1, 1), null, 'no room');
  // Single free cells in different rows: no room for a wide tile
  const scattered = addTile(addTile(layout, 'fotos', 1, 1), 'home', 1, 1);
  assert.deepEqual(occupancy(scattered)[1], ['kal', 'kal', 'home', null]);
  assert.equal(addTile(scattered, 'server', 2, 1), null);
  assert.equal(addTile(layout, 'weg', 1, 1), null, 'already on the grid');
  assert.equal(addTile(layout, 42, 1, 1), null);
});

test('no function changes its input', () => {
  const layout = sparse();
  const before = JSON.stringify(layout);
  // Frozen input: any write would throw in strict mode
  occupancy(layout);
  canPlace(layout, { col: 3, row: 0, w: 1, h: 1 });
  findFreeSpot(layout, 2, 1);
  moveTile(layout, 'weg', 3, 1);
  swapTiles(layout, 'wetter', 'kal');
  resizeTile(layout, 'weg');
  resizeTile(layout, 'wetter');
  removeTile(layout, 'dienste');
  addTile(layout, 'fotos', 1, 1);
  dropTarget(layout, 'weg', { col: 3, row: 0 });
  copyLayout(layout);
  assert.equal(JSON.stringify(layout), before);
  // Results share no objects with the input
  const moved = moveTile(layout, 'weg', 3, 1);
  moved.tiles[0].col = 3;
  moved.hidden.push('x');
  assert.equal(JSON.stringify(layout), before);
});

test('results keep the server form, so the saved echo compares equal', () => {
  let layout = full();
  const steps = [
    (l) => removeTile(l, 'fotos'),
    (l) => resizeTile(l, 'weg'),
    (l) => swapTiles(l, 'kal', 'server'),
    (l) => resizeTile(l, 'weg'),
    (l) => addTile(l, 'fotos', 1, 1),
    (l) => removeTile(l, 'home'),
    (l) => moveTile(l, 'dienste', 2, 2),
  ];
  for (const step of steps) {
    const next = step(layout);
    assert.ok(next, `step ${step} possible`);
    assert.equal(validateLayout(next), null);
    assert.equal(JSON.stringify(next), JSON.stringify(serverClean(next)));
    layout = next;
  }
});

test('random sequences of changes always give valid layouts', () => {
  // Deterministic pseudo-random numbers (mulberry32)
  let seed = 20261016;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const ids = [...DEFAULT_LAYOUT.tiles.map((tile) => tile.id), ...DEFAULT_LAYOUT.hidden];
  let layout = structuredClone(DEFAULT_LAYOUT);
  for (let i = 0; i < 2000; i++) {
    const id = pick(ids);
    const change = pick([
      () => moveTile(layout, id, Math.floor(random() * 5) - 1, Math.floor(random() * 4) - 1),
      () => swapTiles(layout, id, pick(ids)),
      () => resizeTile(layout, id),
      () => removeTile(layout, id),
      () => addTile(layout, id, pick([1, 2]), 1),
    ]);
    const next = change();
    if (!next) continue;
    assert.equal(validateLayout(next), null, JSON.stringify(next));
    assert.equal(validate(next), null);
    assert.equal(next.tiles.length + next.hidden.length, ids.length, 'no widget is lost or doubled');
    layout = next;
  }
});

test('validate agrees with the server on valid and invalid layouts', () => {
  const tile = (id, col, row, w = 1, h = 1) => ({ id, col, row, w, h });
  const samples = [
    DEFAULT_LAYOUT,
    { tiles: [] },
    { tiles: [], hidden: [] },
    { tiles: [tile('a', 0, 0, 4, 3)] },
    { tiles: [tile('a', 3, 2)], hidden: ['b', 'c'] },
    { tiles: [tile('a-1', 0, 0, 2, 1), tile('b2', 2, 0, 2, 1)], hidden: null },
    sparse(),
    null,
    undefined,
    'tiles',
    [],
    {},
    { tiles: 'x' },
    { tiles: [], hidden: 'fotos' },
    { tiles: [], hidden: ['ok', 3] },
    { tiles: [null] },
    { tiles: [tile('Wetter', 0, 0)] },
    { tiles: [tile('', 0, 0)] },
    { tiles: [tile('a'.repeat(41), 0, 0)] },
    { tiles: [{ ...tile('a', 0, 0), id: 7 }] },
    { tiles: [tile('a', 0, 0), tile('a', 1, 0)] },
    { tiles: [tile('a', 0.5, 0)] },
    { tiles: [tile('a', '0', 0)] },
    { tiles: [{ id: 'a', col: 0, row: 0, w: 1 }] },
    { tiles: [tile('a', -1, 0)] },
    { tiles: [tile('a', 0, -1)] },
    { tiles: [tile('a', 3, 0, 2, 1)] },
    { tiles: [tile('a', 0, 2, 1, 2)] },
    { tiles: [tile('a', 4, 0)] },
    { tiles: [tile('a', 0, 0, 0, 1)] },
    { tiles: [tile('a', 0, 0, 1, 0)] },
    { tiles: [tile('a', 0, 0, 2, 1), tile('b', 1, 0)] },
    { tiles: [tile('a', 0, 0, 2, 2), tile('b', 1, 1)] },
  ];
  for (const sample of samples) {
    const server = validateLayout(sample);
    const ours = validate(sample);
    assert.equal(ours === null, server === null, `${JSON.stringify(sample)}: server says ${server}, grid.js says ${ours}`);
    if (ours !== null) assert.equal(typeof ours, 'string');
  }
  assert.ok(samples.filter((s) => validateLayout(s) === null).length >= 6, 'enough valid samples');
});

test('cellAt turns stage pixels into grid cells', () => {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const [x, y, w, h] = rectFor({ col, row, w: 1, h: 1 });
      assert.deepEqual(cellAt(x + w / 2, y + h / 2, GRID), { col, row });
      assert.deepEqual(cellAt(x + 1, y + 1, GRID), { col, row });
      assert.deepEqual(cellAt(x + w - 1, y + h - 1, GRID), { col, row });
    }
  }
  // The gap between two cells is split in the middle
  const [x0, y0, w0] = rectFor({ col: 0, row: 0, w: 1, h: 1 });
  assert.deepEqual(cellAt(x0 + w0 + GRID.gap / 2 - 1, y0 + 10, GRID), { col: 0, row: 0 });
  assert.deepEqual(cellAt(x0 + w0 + GRID.gap / 2 + 1, y0 + 10, GRID), { col: 1, row: 0 });
  // Outside the grid: the clock on the left, below the last row, NaN
  assert.equal(cellAt(400, 300, GRID), null);
  assert.equal(cellAt(GRID.x - GRID.gap, y0 + 10, GRID), null);
  assert.equal(cellAt(1900, y0 + 10, GRID), null);
  assert.equal(cellAt(x0 + 10, 1070, GRID), null);
  assert.equal(cellAt(Number.NaN, 300, GRID), null);
});

test('grabOffset says which part of a tile was grabbed', () => {
  const wide = { col: 2, row: 1, w: 2, h: 1 };
  assert.deepEqual(grabOffset(wide, { col: 3, row: 1 }), { col: 1, row: 0 });
  assert.deepEqual(grabOffset(wide, { col: 2, row: 1 }), { col: 0, row: 0 });
  assert.deepEqual(grabOffset(wide, { col: 0, row: 2 }), { col: 0, row: 0 }, 'clamped into the tile');
  assert.deepEqual(grabOffset(wide, null), { col: 0, row: 0 });
});

test('dropTarget picks swap, move or nothing', () => {
  const layout = sparse();
  // Over a tile of the same size: swap
  assert.deepEqual(dropTarget(layout, 'wetter', { col: 1, row: 1 }), { type: 'swap', id: 'kal' });
  assert.deepEqual(dropTarget(layout, 'weg', { col: 3, row: 2 }), { type: 'swap', id: 'dienste' });
  // Over a tile of another size: nothing
  assert.equal(dropTarget(layout, 'weg', { col: 0, row: 1 }), null);
  // Over free cells: move
  assert.deepEqual(dropTarget(layout, 'weg', { col: 3, row: 1 }), { type: 'move', col: 3, row: 1 });
  // A wide tile grabbed at its right half keeps that half under the pointer
  assert.deepEqual(dropTarget(layout, 'kal', { col: 3, row: 1 }, { col: 1, row: 0 }), { type: 'move', col: 2, row: 1 });
  // Grabbed at its left half and dropped at the right edge: kept inside the grid
  assert.deepEqual(dropTarget(layout, 'kal', { col: 3, row: 1 }, { col: 0, row: 0 }), { type: 'move', col: 2, row: 1 });
  // Free cell, but the wide footprint would cover weg
  assert.equal(dropTarget(layout, 'todo', { col: 3, row: 0 }, { col: 1, row: 0 }), null);
  // Back on its own place, outside the grid, unknown tile
  assert.equal(dropTarget(layout, 'weg', { col: 2, row: 0 }), null);
  assert.equal(dropTarget(layout, 'weg', null), null);
  assert.equal(dropTarget(layout, 'weg', { col: 4, row: 0 }), null);
  assert.equal(dropTarget(layout, 'nope', { col: 3, row: 0 }), null);
  // Every target works with the matching change
  const swap = dropTarget(layout, 'wetter', { col: 1, row: 1 });
  assert.equal(validateLayout(swapTiles(layout, 'wetter', swap.id)), null);
  const move = dropTarget(layout, 'kal', { col: 3, row: 1 }, { col: 1, row: 0 });
  assert.equal(validateLayout(moveTile(layout, 'kal', move.col, move.row)), null);
});
