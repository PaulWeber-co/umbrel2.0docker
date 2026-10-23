import { esc, icon } from '../util.js';

export const label = 'To-dos';

// data: the items (Home Assistant), or { title, items, syncedAt } for a list
// from Apple's Reminders (server/sources/reminders.js)
export function render(data, { entry } = {}) {
  if (!data) return `<div class="lbl">${icon('list')}To-dos</div><div class="loading">Lädt …</div>`;
  const demo = Boolean(entry?.demo);
  const apple = !Array.isArray(data);
  const list = apple ? data.items ?? [] : data;
  const title = apple ? data.title || 'Erinnerungen' : 'To-dos';
  // Typed on the wall, not yet in Reminders: lighter until the next sync
  const pending = (item) => (item.pending ? ' is-pending' : '');
  const items = list.length
    ? list.slice(0, 3).map((item) => demo ? `
      <li><div class="check todo-check todo-readonly"><span class="box"></span><span>${esc(item.summary)}</span></div></li>` : `
      <li><button class="check todo-check${pending(item)}" type="button" data-action="complete" data-payload="${esc(JSON.stringify({ uid: item.uid }))}" aria-label="${esc(item.summary)} erledigen">
        <span class="box">${icon('check')}</span><span>${esc(item.summary)}</span>
      </button></li>`).join('')
    : `<li class="empty">${apple && !data.syncedAt ? 'Wartet auf den ersten Abgleich vom iPhone' : 'Alles erledigt'}</li>`;
  const form = demo ? '' : `<form class="todo-add" data-action="add"><input name="item" maxlength="160" placeholder="${apple ? `Auf „${esc(title)}“ …` : 'Neue Aufgabe …'}" aria-label="Neue Aufgabe" required><button type="submit" aria-label="Aufgabe hinzufügen">${icon('plus')}</button></form>`;
  return `
    <div class="lbl">${icon('list')}${esc(title)}<em>${list.length}</em></div>
    <ul class="todo-list">${items}</ul>
    ${form}`;
}
