// View mode: "hex" (honeycomb) vs "list" (rectangles). A global default is stored
// in localStorage; each page may override it. Effective mode = page override ?? global.
import { h } from './ui.js';

const GLOBAL_KEY = 'view-mode';
const pageKey = (page) => `view-mode:${page}`;

// Small screens don't render the honeycomb well, so default them to list.
function isSmallScreen() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(max-width: 720px)').matches
    : false;
}

// Returns the stored global mode, or a device-appropriate default when unset
// (list on mobile, hex on desktop). An explicit user choice always wins.
export function globalMode() {
  const raw = localStorage.getItem(GLOBAL_KEY);
  if (raw === 'list' || raw === 'hex') return raw;
  return isSmallScreen() ? 'list' : 'hex';
}
export function setGlobalMode(m) { localStorage.setItem(GLOBAL_KEY, m === 'list' ? 'list' : 'hex'); }

export function pageOverride(page) { return localStorage.getItem(pageKey(page)); } // 'hex' | 'list' | null
export function setPageOverride(page, m) {
  if (m === null || m === undefined) localStorage.removeItem(pageKey(page));
  else localStorage.setItem(pageKey(page), m);
}

export function effectiveMode(page) { return pageOverride(page) || globalMode(); }

// A small segmented Hex/List control for a page's action area.
export function viewToggle(page, onChange) {
  const mode = effectiveMode(page);
  const mk = (m, label) => h('button', {
    class: `view-seg ${mode === m ? 'active' : ''}`,
    onclick: () => { if (effectiveMode(page) !== m) { setPageOverride(page, m); onChange(); } },
  }, label);
  return h('div', { class: 'view-toggle' }, mk('hex', 'Hex'), mk('list', 'List'));
}
