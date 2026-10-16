import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

function percent(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

export function toWidgetData(state, now = Date.now()) {
  const capturedAt = Number(state?.capturedAt);
  const fresh = Number.isFinite(capturedAt) && capturedAt <= now + 5_000 && now - capturedAt < 30_000;
  const value = (key) => state?.[key] == null ? null : percent(Number(state[key]));
  return {
    available: Boolean(state?.available && fresh),
    ambientPercent: fresh ? value('ambientPercent') : null,
    backlightPercent: fresh ? value('backlightPercent') : null,
    dark: Boolean(state?.dark && fresh),
  };
}

export default {
  id: 'ambient',
  intervalMs: 5_000,
  isConfigured: (config) => existsSync(config.ambientFile),

  async fetch(ctx) {
    const state = JSON.parse(await readFile(ctx.config.ambientFile, 'utf8'));
    return toWidgetData(state);
  },

  demo: () => ({ available: false, ambientPercent: null, backlightPercent: null, dark: false }),
};
