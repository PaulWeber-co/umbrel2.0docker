// Minifunk on the wall (server/widgets/minifunk.js): while no music plays,
// the side column under the clock shows what came from the Knuddl app.
//
//   text only   glass cards in the style of the tiles, sized to the text:
//               a short line large, a long note or a list smaller; up to
//               three, the newest at the bottom
//   with photo  the photo where the music cover goes, its words in a card
//               flush above it, like title and progress
//
// With both a photo and other messages the two views take turns every
// 20 seconds. × removes a message (it is gone for good). Music always wins;
// the messages wait underneath.
//
// textSize, formatText, ago and toViews are pure and tested in Node.
import { $, esc, icon } from '../util.js';

const ROTATE_MS = 20_000;
const MAX_TEXT_CARDS = 3;

// The longer the message, the smaller the letters: never a towering card
export function textSize(text) {
  const length = String(text ?? '').length;
  const lines = String(text ?? '').split('\n').length;
  if (length <= 32 && lines === 1) return 'xl';
  if (length <= 90 && lines <= 3) return 'l';
  if (length <= 200 && lines <= 6) return 'm';
  return 's';
}

const BULLET = /^\s*(?:[-–•*·]|\d+[.)])\s+/;

// Escaped HTML: lines that start like a list become one, the rest keeps
// its line breaks.
export function formatText(text) {
  const lines = String(text ?? '').split('\n');
  const html = [];
  let list = [];
  const flush = () => {
    if (list.length) html.push(`<ul>${list.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    if (BULLET.test(line)) {
      list.push(line.replace(BULLET, ''));
      continue;
    }
    flush();
    if (line.trim()) html.push(`<p>${esc(line)}</p>`);
  }
  flush();
  return html.join('');
}

export function ago(at, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `vor ${hours} Std.` : 'gestern';
}

// Items (newest first) → the views that take turns: the newest photo, and the
// newest text messages without it
export function toViews(items) {
  const list = Array.isArray(items) ? items : [];
  const photo = list.find((item) => item.photo);
  const texts = list.filter((item) => item !== photo && item.text).slice(0, MAX_TEXT_CARDS).reverse();
  return [...(photo ? [{ kind: 'photo', items: [photo] }] : []), ...(texts.length ? [{ kind: 'text', items: texts }] : [])];
}

function head(item, now) {
  return `<header class="funk-head">${icon('funk')}<b>${esc(item.name)}</b><span class="funk-ago" data-at="${Number(item.at)}">${ago(item.at, now)}</span>
    <button class="funk-x" type="button" data-dismiss="${esc(item.id)}" aria-label="Nachricht von ${esc(item.name)} entfernen">${icon('x')}</button></header>`;
}

function textCard(item, now) {
  return `<article class="funk-card side-card size-${textSize(item.text)}">${head(item, now)}<div class="funk-text">${formatText(item.text)}</div></article>`;
}

function photoView(item, now) {
  const words = item.text
    ? `<div class="funk-text">${formatText(item.text)}</div>`
    : '<div class="funk-text funk-quiet"><p>hat ein Foto gefunkt</p></div>';
  return `<article class="funk-card funk-caption side-card size-${item.text ? textSize(item.text) : 'm'}">${head(item, now)}${words}</article>
    <img class="side-photo funk-photo" src="${esc(item.photo)}" alt="Foto von ${esc(item.name)}">`;
}

export function init(ctx) {
  const host = $('#funk');
  if (!host) return;
  let views = [];
  let shown = 0;
  let key = '';
  let timer = 0;

  ctx.onEntry('minifunk', (entry) => render(entry?.data));

  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dismiss]');
    if (!button) return;
    event.preventDefault();
    const card = button.closest('.funk-card');
    card?.classList.add('leaving');
    ctx.runAction('minifunk', 'dismiss', { id: button.dataset.dismiss }).catch((error) => {
      console.error('Minifunk entfernen:', error);
      card?.classList.remove('leaving');
    });
  });

  // The relative times age; the views take turns
  setInterval(() => {
    const now = Date.now();
    for (const el of host.querySelectorAll('.funk-ago')) el.textContent = ago(Number(el.dataset.at), now);
  }, 60_000);

  function render(data) {
    const items = data?.enabled === false ? [] : data?.items ?? [];
    const next = JSON.stringify(items.map((item) => [item.id, item.text, item.photo]));
    if (next === key) return;
    key = next;
    views = toViews(items);
    const now = Date.now();
    host.innerHTML = views
      .map((view) => `<div class="funk-view is-${view.kind}">${view.kind === 'photo' ? photoView(view.items[0], now) : view.items.map((item) => textCard(item, now)).join('')}</div>`)
      .join('');
    // A stack taller than the column loses its oldest cards
    for (const view of host.querySelectorAll('.funk-view.is-text')) {
      while (view.children.length > 1 && view.scrollHeight > host.clientHeight + 1) view.firstElementChild.remove();
    }
    shown = Math.min(shown, Math.max(0, views.length - 1));
    show();
    clearInterval(timer);
    if (views.length > 1) {
      timer = setInterval(() => {
        shown = (shown + 1) % views.length;
        show();
      }, ROTATE_MS);
    }
  }

  function show() {
    host.querySelectorAll('.funk-view').forEach((el, i) => el.classList.toggle('on', i === shown));
  }
}
