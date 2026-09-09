// Appearance: light/dark theme + accent color, persisted in localStorage and
// applied via a data-theme attribute and CSS custom properties.
const THEME_KEY = 'theme';
const ACCENT_KEY = 'accent';

export const ACCENTS = {
  violet: ['#6366f1', '#a855f7', '#ec4899'],
  blue: ['#3b82f6', '#0ea5e9', '#22d3ee'],
  emerald: ['#10b981', '#14b8a6', '#34d399'],
  amber: ['#f59e0b', '#f97316', '#ef4444'],
  rose: ['#f43f5e', '#ec4899', '#a855f7'],
};
export const ACCENT_NAMES = Object.keys(ACCENTS);

export function getTheme() { return localStorage.getItem(THEME_KEY) || 'light'; }
export function getAccent() { return localStorage.getItem(ACCENT_KEY) || 'violet'; }

// Keep the browser chrome / iOS status-bar tint in sync with the active theme's
// background (index.html only ships a static value). Matches --bg per theme.
const THEME_COLORS = { light: '#eef1fa', dark: '#171a24' };
function applyThemeColor(t) {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.appendChild(meta); }
  meta.setAttribute('content', THEME_COLORS[t] || THEME_COLORS.light);
}

export function applyTheme(theme = getTheme()) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
  applyThemeColor(t);
}

export function applyAccent(name = getAccent()) {
  const a = ACCENTS[name] || ACCENTS.violet;
  const r = document.documentElement.style;
  r.setProperty('--accent', a[0]);
  r.setProperty('--accent-2', a[1]);
  r.setProperty('--accent-3', a[2]);
  r.setProperty('--grad-primary', `linear-gradient(90deg, ${a[0]}, ${a[1]} 55%, ${a[2]})`);
  localStorage.setItem(ACCENT_KEY, ACCENTS[name] ? name : 'violet');
}

export function initAppearance() { applyTheme(); applyAccent(); }
