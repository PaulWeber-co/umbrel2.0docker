// Ambient light from the webcam (scripts/xps-ambient.py → server/widgets/
// ambient.js). No tile: when the room is dark the dashboard switches to the
// night view, whatever the time; otherwise the scene follows the clock.
export function init({ onEntry, setSceneOverride }) {
  let dark = false;
  setSceneOverride(() => (dark ? 'nacht' : null));
  onEntry('ambient', (entry) => {
    dark = Boolean(entry?.data?.available && entry.data.dark);
  });
}
