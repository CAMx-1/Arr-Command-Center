// Appearance: light / dark / black (AMOLED) theme + accent color, persisted in
// localStorage. The theme is applied via data-theme (black also sets
// data-theme="dark" plus data-black, so every dark rule still applies) and the
// accent via CSS custom properties that styles.css uses for buttons, the
// navigation hexes, the page title and the background honeycomb.
import { applyNativeChrome } from './nativeApp.js';
const THEME_KEY = 'theme';
const ACCENT_KEY = 'accent';

// Per accent:
//   c     – accent, accent-2, accent-3 (buttons, links, progress)
//   nav   – navigation hex / page-title gradient
//   hi    – active / highlighted navigation hex
//   deep  – dark shade (RGB) for glows, the honeycomb backdrop, disk fill
export const PALETTES = {
  violet: { c: ['#6366f1', '#a855f7', '#ec4899'], nav: ['#6f6cf2', '#9b45e6'], hi: ['#a78bfa', '#c084fc'], deep: [109, 40, 217] },
  blue: { c: ['#3b82f6', '#0ea5e9', '#22d3ee'], nav: ['#3b82f6', '#0284c7'], hi: ['#60a5fa', '#38bdf8'], deep: [29, 78, 216] },
  emerald: { c: ['#10b981', '#14b8a6', '#34d399'], nav: ['#10b981', '#0d9488'], hi: ['#34d399', '#2dd4bf'], deep: [4, 120, 87] },
  amber: { c: ['#f59e0b', '#f97316', '#ef4444'], nav: ['#f59e0b', '#ea580c'], hi: ['#fbbf24', '#fb923c'], deep: [194, 65, 12] },
  rose: { c: ['#f43f5e', '#ec4899', '#a855f7'], nav: ['#f43f5e', '#db2777'], hi: ['#fb7185', '#f472b6'], deep: [190, 18, 60] },
};
export const ACCENTS = Object.fromEntries(Object.entries(PALETTES).map(([k, p]) => [k, p.c]));
export const ACCENT_NAMES = Object.keys(PALETTES);
export const THEMES = ['light', 'dark', 'black'];

export function normalizeTheme(t) { return THEMES.includes(t) ? t : 'light'; }
export function getTheme() { return normalizeTheme(localStorage.getItem(THEME_KEY)); }
export function getAccent() { const a = localStorage.getItem(ACCENT_KEY); return PALETTES[a] ? a : 'violet'; }

const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// CSS custom properties for an accent palette (pure; exported for tests).
export function accentVars(name) {
  const p = PALETTES[name] || PALETTES.violet;
  const [a, b, c] = p.c;
  return {
    '--accent': a, '--accent-2': b, '--accent-3': c,
    '--accent-rgb': hexToRgb(a).join(', '),
    '--accent-2-rgb': hexToRgb(b).join(', '),
    '--accent-deep-rgb': p.deep.join(', '),
    '--grad-primary': `linear-gradient(90deg, ${a}, ${b} 55%, ${c})`,
    '--nav-1': p.nav[0], '--nav-2': p.nav[1],
    '--nav-hi-1': p.hi[0], '--nav-hi-2': p.hi[1],
  };
}

// Browser chrome / iOS status-bar tint per theme (matches --bg).
export const THEME_COLORS = { light: '#eef1fa', dark: '#171a24', black: '#000000' };
function applyThemeColor(t) {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.appendChild(meta); }
  meta.setAttribute('content', THEME_COLORS[t] || THEME_COLORS.light);
}

const notify = () => { try { window.dispatchEvent(new Event('acc:appearance')); } catch { /* non-DOM */ } };

export function applyTheme(theme = getTheme()) {
  const t = normalizeTheme(theme);
  const root = document.documentElement;
  root.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  if (t === 'black') root.setAttribute('data-black', ''); else root.removeAttribute('data-black');
  localStorage.setItem(THEME_KEY, t);
  applyThemeColor(t);
  applyNativeChrome(t).catch(() => {});
  notify();
}

export function applyAccent(name = getAccent()) {
  const key = PALETTES[name] ? name : 'violet';
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(accentVars(key))) r.setProperty(k, v);
  localStorage.setItem(ACCENT_KEY, key);
  notify();
}

export function initAppearance() { applyTheme(); applyAccent(); }
