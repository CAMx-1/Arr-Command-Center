// Tells the settings sync (prefSync.js) that a synced setting changed.
// Kept separate so the setting modules don't import the sync code.
export function prefsChanged() {
  try { if (typeof globalThis.dispatchEvent === 'function') globalThis.dispatchEvent(new Event('acc:prefs-changed')); } catch { /* not in a browser */ }
}
