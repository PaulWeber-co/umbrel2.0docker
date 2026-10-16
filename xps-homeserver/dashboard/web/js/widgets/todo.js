import { esc, icon } from '../util.js';

export const label = 'To-dos';

export function render(data, { entry } = {}) {
  if (!data) return `<div class="lbl">${icon('list')}To-dos</div><div class="loading">Lädt …</div>`;
  const demo = Boolean(entry?.demo);
  const items = data.length
    ? data.slice(0, 3).map((item) => demo ? `
      <li><div class="check todo-check todo-readonly"><span class="box"></span><span>${esc(item.summary)}</span></div></li>` : `
      <li><button class="check todo-check" type="button" data-action="complete" data-payload="${esc(JSON.stringify({ uid: item.uid }))}" aria-label="${esc(item.summary)} erledigen">
        <span class="box">${icon('check')}</span><span>${esc(item.summary)}</span>
      </button></li>`).join('')
    : '<li class="empty">Alles erledigt</li>';
  const form = demo ? '' : `<form class="todo-add" data-action="add"><input name="item" maxlength="160" placeholder="Neue Aufgabe …" aria-label="Neue Aufgabe" required><button type="submit" aria-label="Aufgabe hinzufügen">${icon('plus')}</button></form>`;
  return `
    <div class="lbl">${icon('list')}To-dos<em>${data.length}</em></div>
    <ul class="todo-list">${items}</ul>
    ${form}`;
}
