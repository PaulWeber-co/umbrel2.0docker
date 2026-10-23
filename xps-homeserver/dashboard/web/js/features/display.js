// What the wall display shows, decided by the control center on the server
// (server/control.js) and pushed with every "control" event:
//
//   on     the dashboard, its scene by time of day
//   night  only the dimmed clock (scene "nacht")
//   sleep  black; a tap wakes it
//   off    the kiosk browser is stopped by xps-control anyway
//
// Only the kiosk on the XPS (?kiosk=1) goes dark and wakes on a tap. A
// browser on a Mac or phone keeps showing the dashboard and names the wall's
// state in a chip, so looking at the dashboard never changes the wall.
// The feature switches reach the page here too: background videos and the
// music view (data-musicmode, read by music.js).
import { $ } from '../util.js';

const NAMES = { night: 'Nachtuhr', sleep: 'schwarz', off: 'aus' };

export function init({ stage, kiosk, scenes, onControl, setSceneOverride }) {
  let display = 'on';
  let touchWake = 0;
  let waking = false;
  let wokeAt = 0;
  const chip = $('#chip-wall');

  setSceneOverride(() => (kiosk && display === 'night' ? 'nacht' : null));

  onControl((snapshot) => {
    const settings = snapshot?.settings;
    display = snapshot?.effective?.display ?? 'on';
    touchWake = settings?.rules?.touchWake ?? 0;
    stage.dataset.display = kiosk ? display : 'on';
    stage.dataset.musicmode = settings?.features?.musicMode === false ? '0' : '1';
    const dark = kiosk && (display === 'sleep' || display === 'off');
    scenes.setVideos(settings?.features?.videos !== false && !dark);
    if (chip) {
      const away = !kiosk && NAMES[display];
      chip.classList.toggle('on', Boolean(away));
      if (away) chip.lastChild.textContent = `Wandbildschirm ${away}`;
    }
  });

  // A tap on the black screen or the night clock: show the dashboard for a
  // few minutes. The tap itself never reaches a tile underneath.
  stage.addEventListener(
    'pointerdown',
    (event) => {
      if (!kiosk || !touchWake || (display !== 'sleep' && display !== 'night')) return;
      event.preventDefault();
      event.stopPropagation();
      wokeAt = Date.now();
      if (waking) return;
      waking = true;
      fetch('/api/control/wake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .catch((error) => console.error('Aufwecken:', error))
        .finally(() => {
          waking = false;
        });
    },
    true,
  );
  // ... nor does the click that follows it, even if the tiles are back by then
  stage.addEventListener(
    'click',
    (event) => {
      if (Date.now() - wokeAt > 800) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}
