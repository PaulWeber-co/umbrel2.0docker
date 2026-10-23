// Ambient light from the webcam sensor service (scripts/xps-ambient.py), read
// from the JSON file it writes. No tile: the control center (server/control.js)
// switches to the night clock while the room is dark. paused means the
// control center switched the camera off (screen dark or off).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

function percent(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

// A reading counts while the next one is not overdue: two intervals of the
// sensor (scripts/xps-ambient.py measures every 45 s, in the dark every 120 s).
export function toWidgetData(state, now = Date.now()) {
  const capturedAt = Number(state?.capturedAt);
  const interval = Number(state?.intervalSeconds) > 0 ? Number(state.intervalSeconds) : 15;
  const fresh = Number.isFinite(capturedAt) && capturedAt <= now + 5_000 && now - capturedAt < 2 * interval * 1000;
  const value = (key) => state?.[key] == null ? null : percent(Number(state[key]));
  return {
    available: Boolean(state?.available && fresh),
    ambientPercent: fresh ? value('ambientPercent') : null,
    dark: Boolean(state?.dark && fresh),
    paused: Boolean(state?.paused),
  };
}

export default {
  id: 'ambient',
  intervalMs: 10_000,
  isConfigured: (config) => existsSync(config.ambientFile),

  async fetch(ctx) {
    const state = JSON.parse(await readFile(ctx.config.ambientFile, 'utf8'));
    return toWidgetData(state);
  },

  demo: () => ({ available: false, ambientPercent: null, dark: false, paused: false }),
};
