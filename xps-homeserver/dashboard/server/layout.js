// The tile grid of design A: 4 columns × 3 rows on the right of the clock.
// A layout lists each visible tile with its grid position and size; widgets
// the user removed in edit mode are listed under hidden.

export const GRID = { cols: 4, rows: 3 };

export const DEFAULT_LAYOUT = {
  tiles: [
    { id: 'wetter', col: 0, row: 0, w: 2, h: 1 },
    { id: 'weg', col: 2, row: 0, w: 1, h: 1 },
    { id: 'fotos', col: 3, row: 0, w: 1, h: 1 },
    { id: 'kal', col: 0, row: 1, w: 2, h: 1 },
    { id: 'server', col: 2, row: 1, w: 2, h: 1 },
    { id: 'todo', col: 0, row: 2, w: 2, h: 1 },
    { id: 'home', col: 2, row: 2, w: 1, h: 1 },
    { id: 'dc', col: 3, row: 2, w: 1, h: 1 },
  ],
  hidden: [],
};

// Returns an error message, or null when the layout is valid.
export function validateLayout(layout) {
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.tiles)) return 'tiles fehlt';
  const hidden = layout.hidden ?? [];
  if (!Array.isArray(hidden) || hidden.some((id) => typeof id !== 'string')) return 'hidden muss eine Liste von IDs sein';
  const seen = new Set();
  const taken = new Set();
  for (const tile of layout.tiles) {
    const { id, col, row, w, h } = tile ?? {};
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return `ungültige ID ${JSON.stringify(id)}`;
    if (seen.has(id)) return `${id} kommt doppelt vor`;
    seen.add(id);
    if (![col, row, w, h].every(Number.isInteger)) return `${id}: col, row, w und h müssen ganze Zahlen sein`;
    if (col < 0 || row < 0 || w < 1 || h < 1 || col + w > GRID.cols || row + h > GRID.rows) return `${id} liegt außerhalb des Rasters`;
    for (let c = col; c < col + w; c++) {
      for (let r = row; r < row + h; r++) {
        if (taken.has(`${c},${r}`)) return `${id} überlappt eine andere Kachel`;
        taken.add(`${c},${r}`);
      }
    }
  }
  return null;
}
