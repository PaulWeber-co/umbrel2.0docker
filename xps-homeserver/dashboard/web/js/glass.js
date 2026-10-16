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
    '--glass-base': opacity(.04, .22),
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

export function initGlassSettings({ toggle, overlay, slider, close, keyboard }) {
  const setOpen = (open) => {
    overlay.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Glas-Einstellungen schließen' : 'Glas-Einstellungen öffnen');
    if (open) slider.focus();
    else toggle.focus();
  };

  overlay.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Glas-Einstellungen öffnen');
  toggle.addEventListener('click', () => setOpen(overlay.hidden));
  close.addEventListener('click', () => setOpen(false));
  keyboard.addEventListener('keydown', (event) => {
    if (overlay.hidden) return;
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    if (event.shiftKey && keyboard.activeElement === close) {
      event.preventDefault();
      slider.focus();
    } else if (!event.shiftKey && keyboard.activeElement === slider) {
      event.preventDefault();
      close.focus();
    }
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) setOpen(false);
  });
}
