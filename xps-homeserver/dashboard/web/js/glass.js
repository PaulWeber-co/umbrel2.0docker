// The glass effect of tiles and the music view, from clear (0) to milky
// (100). One value for every browser and the kiosk: the slider lives in the
// control center, app.js saves it with PUT /api/settings.
export const DEFAULT_GLASS = 55;

export function normalizeGlass(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_GLASS;
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_GLASS;
  return Math.round(Math.min(100, Math.max(0, number)));
}

export function glassProperties(value) {
  const amount = normalizeGlass(value) / 100;
  const interpolate = (clear, milky) => clear + (milky - clear) * amount;
  const opacity = (clear, milky) => interpolate(clear, milky).toFixed(3);
  return {
    '--glass-blur': `${Math.round(interpolate(14, 40))}px`,
    '--glass-saturate': `${Math.round(interpolate(120, 210))}%`,
    '--glass-base': opacity(.12, .3),
    '--glass-top': opacity(.10, .46),
    '--glass-mid': opacity(.04, .15),
    '--glass-low': opacity(.02, .093),
    '--glass-bottom': opacity(.05, .21),
    '--glass-border': opacity(.16, .48),
    '--glass-shine': opacity(.24, .80),
  };
}

export function applyGlass(stage, value) {
  const normalized = normalizeGlass(value);
  for (const [property, setting] of Object.entries(glassProperties(normalized))) {
    stage.style.setProperty(property, setting);
  }
  return normalized;
}
