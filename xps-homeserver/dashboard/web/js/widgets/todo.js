// To-dos from the Knuddl app (server/widgets/todo.js). 1×1: up to three open
// to-dos, the circle in the colour of whoever does it (lila, pink, both for
// "zusammen"). With everything done: the bucket list, one item a minute, and
// "To-dos erledigt" underneath. 2×1: to-dos left, the top of the bucket list
// right. Which of the two shows is up to the tile's width (container query in
// web/css/w-todo.css). Every value through esc(); nothing to tap.
import { esc, icon } from '../util.js';

export const label = 'To-dos';

const ZEICHEN = { 1: '♥', 2: '✓', 3: '–' };
const WORT = { 1: 'unbedingt', 2: 'gern', 3: 'eher nicht' };

const stimme = (s) => `<span class="td-st td-${esc(s.farbe)} td-l${s.l ?? 0}" title="${esc(`${s.name}: ${s.l ? WORT[s.l] : 'noch offen'}`)}">${s.l ? ZEICHEN[s.l] : '?'}</span>`;
const stimmen = (item) => `<span class="td-stimmen">${item.stimmen.map(stimme).join('')}</span>`;

function todoZeile(todo) {
  const wann = todo.wann && ['ueberfaellig', 'heute', 'morgen'].includes(todo.gruppe) ? `<span class="td-wann td-${esc(todo.gruppe)}">${esc(todo.wann)}</span>` : '';
  return `<li class="td-row"><span class="td-kreis td-${esc(todo.farbe)}"></span><span class="td-text">${esc(todo.text)}${wann}</span></li>`;
}

const bucketZeile = (item, i) => `
  <li class="td-b"><span class="td-platz">${i + 1}</span><span class="td-b-text"><span>${esc(item.text)}</span>${stimmen(item)}</span></li>`;

// The bucket item on show this minute, large
function fokus(data) {
  const item = data.bucket[data.fokus] ?? data.bucket[0];
  if (!item) return '<div class="td-fertig-leer">Alles erledigt</div>';
  const urteil = item.unbedingt ? 'beide unbedingt' : item.einig ? 'wollt ihr beide' : '';
  return `
    <div class="td-fokus">
      <div class="td-gross">${esc(item.text)}</div>
      <div class="td-fokus-st">${stimmen(item)}${urteil ? `<span class="td-urteil">${esc(urteil)}</span>` : ''}</div>
    </div>
    ${data.bucket.length > 1 ? `<div class="td-punkte">${data.bucket.map((_, i) => `<i class="${i === data.fokus ? 'an' : ''}"></i>`).join('')}</div>` : ''}`;
}

export function render(data) {
  const head = (title, extra = '', symbol = 'check') => `<div class="lbl">${icon(symbol)}${esc(title)}${extra ? `<em>${esc(extra)}</em>` : ''}</div>`;
  if (!data) return `${head(label)}<div class="loading">Lädt …</div>`;
  if (data.leer) return `${head(label)}<div class="sub td-hinweis">Noch nichts aus Knuddl. In der App: Wir → Bucketlist.</div>`;
  const offen = data.todos.length > 0;
  if (offen) {
    return `
      ${head(label, String(data.offen))}
      <div class="td td-offen">
        <ul class="td-list">${data.todos.slice(0, 6).map(todoZeile).join('')}</ul>
        ${data.bucket.length ? `<div class="td-rechts"><div class="td-kick">Bucketlist · als Nächstes</div><ol class="td-blist">${data.bucket.slice(0, 3).map(bucketZeile).join('')}</ol></div>` : ''}
      </div>`;
  }
  return `
    ${head('Bucketlist', data.bucket.length > 1 ? `${data.fokus + 1} / ${data.bucket.length}` : '', 'list')}
    <div class="td td-alles">
      <div class="td-schmal">${fokus(data)}</div>
      ${data.bucket.length ? `<div class="td-rechts td-breit"><div class="td-kick">Als Nächstes</div><ol class="td-blist">${data.bucket.slice(0, 3).map(bucketZeile).join('')}</ol></div>` : ''}
      <div class="td-erledigt">To-dos erledigt ✓</div>
    </div>`;
}
