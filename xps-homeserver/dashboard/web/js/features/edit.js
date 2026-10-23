// Edit mode for the tile grid. A long press (600 ms, finger still) or a double
// click on a tile starts it; "Fertig" or Escape ends it. In edit mode a tile
// can be dragged onto free cells or onto a tile of the same size (they swap),
// × hides it, the arrow button toggles its width, and the edit bar brings
// hidden widgets back. Pointer events cover the touch screen on the wall and
// a mouse on a Mac or iPhone browser alike.
//
// Each change is saved at once with PUT /api/layout; saves run one after the
// other, and when one fails the last layout the server accepted comes back.
// The grid arithmetic lives in grid.js; app.js lists this module in FEATURES.
import { addTile, cellAt, dropTarget, grabOffset, moveTile, occupancy, removeTile, resizeTile, swapTiles, validate } from '../grid.js';
import { GRID, rectFor } from '../layout.js';
import { $, $$, esc, icon } from '../util.js';
import widgets from '../widgets/index.js';

// Size a widget gets when it comes back from the edit bar; everything else is 1×1.
export const DEFAULT_SIZES = {
  wetter: { w: 2, h: 1 },
  kal: { w: 2, h: 1 },
  server: { w: 2, h: 1 },
  todo: { w: 2, h: 1 },
};
const sizeOf = (id) => DEFAULT_SIZES[id] ?? { w: 1, h: 1 };

const LONG_PRESS_MS = 600;
const LONG_PRESS_SLOP = 10; // screen px a finger may wander during a long press
const DRAG_SLOP = 8; // screen px before a press in edit mode becomes a drag
const MESSAGE_MS = 3000;
const SAVE_TIMEOUT_MS = 10_000;
const SETTLE_MS = 800; // a little longer than the FLIP animation in layout.js

// A press here never drags or long-presses: the tile's own buttons and form fields
const NO_DRAG = '.x, .resize, input, textarea, select, label, form button, [contenteditable]';
// A double click here belongs to the widget (a switch, a link), not to edit mode
const INTERACTIVE = 'button, a, input, textarea, select, label, [data-action], [contenteditable]';

const RESIZE_BUTTON =
  '<button class="resize" type="button" aria-label="Größe ändern">' +
  '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12h17M7.5 8l-4 4 4 4M16.5 8l4 4-4 4"/></svg>' +
  '</button>';

export function init(ctx) {
  const stage = ctx?.stage;
  const state = ctx?.state;
  const host = stage && $('#tiles', stage);
  if (!host || !state) {
    console.warn('Bearbeiten: #tiles oder state fehlt, Bearbeiten-Modus aus');
    return;
  }
  const bar = $('.editbar', stage);
  const addList = $('#add-list', stage);
  const done = $('#btn-done', stage);
  const hint = bar?.querySelector('span:not(.add)');
  hint?.classList.add('edit-hint');
  const message = document.createElement('span');
  message.className = 'edit-msg';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  if (hint) hint.after(message);
  else bar?.prepend(message);

  let editing = stage.dataset.edit === '1';
  let longPress = null; // normal mode: { el, pointerId, x, y, timer } until 600 ms pass
  let press = null; // edit mode: { el, id, pointerId, x, y, grab, dragging }
  let overlay = null; // free cells and the landing spot while dragging
  let swallowClick = false; // the click that ends a long press
  let messageTimer = 0;
  let saving = Promise.resolve();
  let pending = 0;
  let saved = state.layout; // the last layout the server holds

  const scale = () => state.scale || 1;
  const tileById = (id) => host.querySelector(`.t[data-id="${CSS.escape(id)}"]`);
  const findTile = (id) => (state.layout?.tiles ?? []).find((tile) => tile.id === id) ?? null;
  const tileOf = (target) => {
    const el = target?.closest?.('.t');
    return el && el.parentElement === host && !el.classList.contains('gone') ? el : null;
  };
  // Pointer position in stage pixels and the grid cell under it
  const stagePoint = ({ clientX, clientY }) => {
    const box = stage.getBoundingClientRect();
    return { x: (clientX - box.left) / scale(), y: (clientY - box.top) / scale() };
  };
  const cellUnder = (point) => {
    const { x, y } = stagePoint(point);
    return cellAt(x, y, GRID);
  };
  const place = (el, [x, y, w, h]) => Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });

  /* ---------- entering and leaving ---------- */
  function setEdit(on) {
    stage.dataset.edit = on ? '1' : '0';
    sync();
  }

  // Runs on every change of data-edit, also when another feature sets it.
  function sync() {
    const on = stage.dataset.edit === '1';
    if (on === editing) return;
    editing = on;
    cancelLongPress();
    const wasDragging = Boolean(press?.dragging);
    endPress(null);
    if (on) renderAddList();
    else clearMessage();
    if (!wasDragging) ctx.relayout(true);
  }
  new MutationObserver(sync).observe(stage, { attributes: true, attributeFilter: ['data-edit'] });

  done?.addEventListener('click', () => setEdit(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editing) setEdit(false);
  });

  host.addEventListener('dblclick', (event) => {
    if (editing || !tileOf(event.target) || event.target.closest(INTERACTIVE)) return;
    event.preventDefault();
    setEdit(true);
  });

  /* ---------- long press (normal mode) ---------- */
  function startLongPress(event, el) {
    cancelLongPress();
    const start = { el, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    start.timer = setTimeout(() => {
      longPress = null;
      if (!el.isConnected) return;
      swallowClick = true;
      setEdit(true);
      // Keep holding and move: the tile drags at once, as on a phone
      startPress({ pointerId: start.pointerId, clientX: start.x, clientY: start.y }, el);
    }, LONG_PRESS_MS);
    longPress = start;
  }

  function cancelLongPress() {
    if (!longPress) return;
    clearTimeout(longPress.timer);
    longPress = null;
  }

  // The release after a long press must not press the × that just appeared
  // under the finger, nor a widget button.
  stage.addEventListener(
    'pointerdown',
    () => {
      swallowClick = false;
    },
    true,
  );
  stage.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  // No context menu, text selection or image drag while pressing a tile
  host.addEventListener('contextmenu', (event) => {
    if (longPress || editing) event.preventDefault();
  });
  host.addEventListener('dragstart', (event) => {
    if (editing || longPress) event.preventDefault();
  });

  /* ---------- dragging (edit mode) ---------- */
  host.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const el = tileOf(event.target);
    if (!el || event.target.closest(NO_DRAG)) return;
    if (press && !press.dragging) press = null;
    if (editing) startPress(event, el);
    else startLongPress(event, el);
  });

  function startPress(point, el) {
    if (press?.dragging) return;
    const id = el.dataset.id;
    const tile = findTile(id);
    if (!tile) return;
    press = { el, id, pointerId: point.pointerId, x: point.clientX, y: point.clientY, grab: grabOffset(tile, cellUnder(point)), dragging: false };
  }

  stage.addEventListener('pointermove', (event) => {
    if (longPress && event.pointerId === longPress.pointerId) {
      if (event.buttons === 0 || Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y) > LONG_PRESS_SLOP) cancelLongPress();
    }
    if (!press || event.pointerId !== press.pointerId) return;
    if (event.buttons === 0) {
      // released somewhere we did not hear about
      endPress(null);
      return;
    }
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!press.dragging) {
      if (Math.hypot(dx, dy) <= DRAG_SLOP) return;
      beginDrag();
    }
    press.el.style.transform = `translate(${dx / scale()}px, ${dy / scale()}px)`;
    showTarget(dropTarget(state.layout, press.id, cellUnder(event), press.grab));
  });

  stage.addEventListener('pointerup', (event) => {
    if (longPress?.pointerId === event.pointerId) cancelLongPress();
    if (press?.pointerId === event.pointerId) endPress(event);
  });
  stage.addEventListener('pointercancel', (event) => {
    if (longPress?.pointerId === event.pointerId) cancelLongPress();
    if (press?.pointerId === event.pointerId) endPress(null);
  });
  host.addEventListener('lostpointercapture', (event) => {
    if (press?.dragging && event.pointerId === press.pointerId) endPress(null);
  });

  function beginDrag() {
    press.dragging = true;
    const { el, pointerId } = press;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // the pointer is already gone; pointerup/cancel still reach the stage
    }
    // A FLIP animation still running would override the drag transform
    for (const animation of el.getAnimations?.() ?? []) animation.cancel();
    el.classList.add('dragging');
    showCells();
  }

  // pointerup → drop where the pointer is; null → cancel and snap back.
  function endPress(event) {
    const current = press;
    press = null;
    if (!current) return;
    current.el.classList.remove('dragging');
    for (const el of $$('.t.target', host)) el.classList.remove('target');
    hideCells();
    if (!current.dragging) return;
    try {
      if (current.el.hasPointerCapture?.(current.pointerId)) current.el.releasePointerCapture(current.pointerId);
    } catch {
      // nothing to release
    }
    const target = event ? dropTarget(state.layout, current.id, cellUnder(event), current.grab) : null;
    let next = null;
    if (target?.type === 'swap') next = swapTiles(state.layout, current.id, target.id);
    if (target?.type === 'move') next = moveTile(state.layout, current.id, target.col, target.row);
    // Keep the tile above its neighbours while it flies to its place
    current.el.classList.add('settling');
    setTimeout(() => current.el.classList.remove('settling'), SETTLE_MS);
    // relayout() clears the drag transform and animates from the drop point (FLIP)
    if (!next || !commit(next)) ctx.relayout(true);
  }

  // Dashed outlines of the free cells (the dragged tile's own count as free)
  // and one outline for the landing spot, behind the tiles.
  function showCells() {
    hideCells();
    overlay = document.createElement('div');
    overlay.className = 'edit-grid';
    overlay.setAttribute('aria-hidden', 'true');
    const cells = occupancy({ tiles: (state.layout?.tiles ?? []).filter((tile) => tile.id !== press.id) });
    cells.forEach((cols, row) =>
      cols.forEach((id, col) => {
        if (id !== null) return;
        const cell = document.createElement('div');
        cell.className = 'edit-cell';
        place(cell, rectFor({ col, row, w: 1, h: 1 }));
        overlay.append(cell);
      }),
    );
    const drop = document.createElement('div');
    drop.className = 'edit-drop';
    overlay.append(drop);
    host.before(overlay);
  }

  function hideCells() {
    overlay?.remove();
    overlay = null;
  }

  function showTarget(target) {
    const swapId = target?.type === 'swap' ? target.id : null;
    for (const el of $$('.t.target', host)) if (el.dataset.id !== swapId) el.classList.remove('target');
    if (swapId) tileById(swapId)?.classList.add('target');
    const drop = overlay?.querySelector('.edit-drop');
    if (!drop) return;
    const tile = findTile(press.id);
    if (target?.type === 'move' && tile) {
      place(drop, rectFor({ col: target.col, row: target.row, w: tile.w, h: tile.h }));
      drop.classList.add('target');
    } else drop.classList.remove('target');
  }

  /* ---------- ×, resize and the add list ---------- */
  host.addEventListener('click', (event) => {
    if (!editing || press?.dragging) return;
    const button = event.target.closest('.x, .resize');
    const el = button && tileOf(button);
    if (!el) return;
    event.preventDefault();
    const id = el.dataset.id;
    if (button.classList.contains('x')) {
      const next = removeTile(state.layout, id);
      if (next) commit(next);
      return;
    }
    const next = resizeTile(state.layout, id);
    if (next) commit(next);
    else flash('Daneben ist kein Platz.');
  });

  addList?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-add]');
    if (!button || !editing || press?.dragging) return;
    const id = button.dataset.add;
    const { w, h } = sizeOf(id);
    const next = addTile(state.layout, id, w, h);
    if (next) commit(next);
    else flash('Kein Platz frei. Erst eine Kachel entfernen.');
  });

  function renderAddList() {
    if (!addList) return;
    const visible = new Set((state.layout?.tiles ?? []).map((tile) => tile.id));
    const hidden = [...new Set(state.layout?.hidden ?? [])].filter((id) => !visible.has(id));
    addList.innerHTML = hidden
      .map((id) => {
        const name = widgets[id]?.label ?? id;
        return `<button type="button" data-add="${esc(id)}" aria-label="${esc(name)} hinzufügen">${icon('plus')}${esc(name)}</button>`;
      })
      .join('');
  }

  // Every tile gets a resize button next to its ×, also after buildTiles()
  // rebuilt them (a layout change from another device).
  function ensureButtons() {
    for (const el of host.children) {
      if (!el.classList.contains('t') || [...el.children].some((child) => child.classList.contains('resize'))) continue;
      const x = [...el.children].find((child) => child.classList.contains('x'));
      if (x) x.insertAdjacentHTML('afterend', RESIZE_BUTTON);
      else el.insertAdjacentHTML('beforeend', RESIZE_BUTTON);
    }
  }
  new MutationObserver(() => {
    ensureButtons();
    if (press && !press.el.isConnected) endPress(null);
    if (longPress && !longPress.el.isConnected) cancelLongPress();
    if (editing) renderAddList();
  }).observe(host, { childList: true });
  ensureButtons();
  if (editing) renderAddList();

  /* ---------- apply and save ---------- */
  function commit(next) {
    const problem = validate(next);
    if (problem) {
      console.error('Bearbeiten: Layout ungültig:', problem);
      return false;
    }
    if (pending === 0) saved = state.layout;
    state.layout = next;
    if (next.tiles.some((tile) => !tileById(tile.id))) ctx.buildTiles();
    ctx.relayout(true);
    renderAddList();
    pending++;
    saving = saving
      .then(async () => {
        try {
          await putLayout(next);
          saved = next;
        } catch (error) {
          console.error('Layout speichern:', error);
          // Only undo when nothing newer is on screen; a newer change is saved next.
          if (state.layout === next) {
            state.layout = saved;
            if (saved.tiles.some((tile) => !tileById(tile.id))) ctx.buildTiles();
            ctx.relayout(true);
            renderAddList();
          }
          flash(/^Gesperrt/.test(error.message) ? 'Gesperrt: PIN in der Steuerung eingeben' : 'Speichern fehlgeschlagen');
        } finally {
          pending--;
        }
      })
      .catch((error) => console.error('Bearbeiten:', error));
    return true;
  }

  async function putLayout(layout) {
    const response = await fetch('/api/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tiles: layout.tiles, hidden: layout.hidden }),
      signal: AbortSignal.timeout?.(SAVE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
  }

  /* ---------- short notes in the edit bar ---------- */
  function flash(text) {
    if (!bar) {
      console.warn(text);
      return;
    }
    message.textContent = text;
    bar.classList.add('has-msg');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(clearMessage, MESSAGE_MS);
  }

  function clearMessage() {
    clearTimeout(messageTimer);
    bar?.classList.remove('has-msg');
    message.textContent = '';
  }
}
