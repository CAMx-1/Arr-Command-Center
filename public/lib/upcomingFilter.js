// Per-instance filter for the Overview "Upcoming" calendar (e.g. hide the 4K
// or anime instance so duplicates don't clutter the list). Stores the set of
// HIDDEN service keys, so newly added instances show up by default.
const KEY = 'upcoming-hidden';
const storageFor = (s) => s || globalThis.localStorage;

export function hiddenUpcoming(storage) {
  try {
    const v = JSON.parse(storageFor(storage).getItem(KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}

export function setUpcomingHidden(key, hidden, storage) {
  const set = hiddenUpcoming(storage);
  if (hidden) set.add(key); else set.delete(key);
  try { storageFor(storage).setItem(KEY, JSON.stringify([...set])); } catch { /* ignore */ }
  return set;
}

// The instances to fetch: everything not hidden. If every instance would be
// hidden, show them all instead of an empty calendar with no way to tell why.
export function visibleUpcomingServices(services, storage) {
  const hidden = hiddenUpcoming(storage);
  const shown = services.filter((s) => !hidden.has(s.key));
  return shown.length ? shown : services;
}
