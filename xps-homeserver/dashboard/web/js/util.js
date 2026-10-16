// Helpers shared by the front-end modules.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Every value from the server goes through esc() before it lands in HTML.
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// An icon from the sprite in index.html, e.g. icon('cloud')
export const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// German number formatting: 18432 → "18.432", 5.1 → "5,1"
export const num = (value, digits = 0) =>
  Number(value).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
