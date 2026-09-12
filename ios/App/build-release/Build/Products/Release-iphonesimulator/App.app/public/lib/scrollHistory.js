// Pure helpers for history-state–aware scroll tracking.
//
// The app is a hash-routed SPA that also pushes throwaway history entries for
// overlays. To give each *route* entry its own remembered scroll position we
// tag every history entry with a monotonic `navId` (merged into whatever state
// the overlay controller already stored) and keep a small LRU of navId ->
// scrollY. These helpers are DOM/history free so they can be unit-tested.

// Shallow-merge a patch into an existing history.state object without dropping
// unrelated keys (e.g. the overlay controller's `{ overlay: id }`).
export function mergeState(prev, patch) {
  const base = (prev && typeof prev === 'object') ? prev : {};
  return { ...base, ...(patch || {}) };
}

// Decide how a navigation should treat scroll:
//   'preserve' — reload / pull-to-refresh / manual refresh: keep where we are.
//   'restore'  — browser Back/Forward to an entry we have a saved position for.
//   'new'      — a brand new route entry: start at the top.
// An explicit `pendingIntent` (set by reload/refresh call sites) always wins.
export function classifyNavigation({ pendingIntent, navId, knownIds } = {}) {
  if (pendingIntent === 'preserve' || pendingIntent === 'restore' || pendingIntent === 'new') return pendingIntent;
  if (navId != null && knownIds && typeof knownIds.has === 'function' && knownIds.has(navId)) return 'restore';
  return 'new';
}

// Target scroll offset for a classified navigation.
export function targetScrollFor({ kind, currentY = 0, savedY = 0 } = {}) {
  if (kind === 'restore') return Math.max(0, Number(savedY) || 0);
  if (kind === 'preserve') return Math.max(0, Number(currentY) || 0);
  return 0; // 'new' (and anything unexpected) starts at the top
}

// A tiny bounded LRU of navId -> scrollY. Bounded so long sessions with many
// route entries never grow without limit (no leaks).
export function createScrollStore(limit = 50) {
  const map = new Map();
  return {
    save(id, y) {
      if (id == null) return;
      map.delete(id); // re-insert to mark most-recently-used
      map.set(id, Math.max(0, Number(y) || 0));
      while (map.size > limit) map.delete(map.keys().next().value);
    },
    get(id) { return map.has(id) ? map.get(id) : null; },
    has(id) { return map.has(id); },
    get keys() { return map; },
    get size() { return map.size; },
  };
}
