// UI density preference: "comfortable" (default) vs "compact". Persisted in
// localStorage and applied via a `data-density` attribute on <html>, which CSS
// keys off to tighten row/table/dashboard-feed spacing (see styles.css).

const DENSITY_KEY = 'acc:density';

export const DENSITIES = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
];
const VALID = new Set(DENSITIES.map((d) => d.id));
const DEFAULT_DENSITY = 'comfortable';

const storageFor = (storage) => storage || globalThis.localStorage;

// Coerce any input to a valid density id (falls back to the default).
export function normalizeDensity(value) {
  return VALID.has(value) ? value : DEFAULT_DENSITY;
}

// Read the stored density (default when unset/invalid/unavailable).
export function getDensity(storage) {
  try { return normalizeDensity(storageFor(storage).getItem(DENSITY_KEY)); }
  catch { return DEFAULT_DENSITY; }
}

// Reflect the density onto the document so CSS can react. No-op off-DOM.
export function applyDensity(value = getDensity()) {
  const density = normalizeDensity(value);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-density', density);
  }
  return density;
}

// Persist + apply a new density. Returns the normalized value that was stored.
export function setDensity(value, storage) {
  const density = normalizeDensity(value);
  try { storageFor(storage).setItem(DENSITY_KEY, density); } catch { /* ignore */ }
  applyDensity(density);
  return density;
}

// Apply the saved density at app startup.
export function initDensity() { return applyDensity(getDensity()); }
