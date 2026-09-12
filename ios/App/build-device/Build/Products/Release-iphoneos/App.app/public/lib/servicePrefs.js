// Persisted per-service preferences: visibility (hidden) and display order.
// Affects the sidebar hive and the Home services section. Routing still works
// for hidden services if navigated to directly.
const HIDDEN_KEY = 'svc-hidden';
const ORDER_KEY = 'svc-order';

// Mobile bottom-bar favorites. Keep the existing storage key so current users
// retain their choices when the control moves from the all-services sheet into
// Settings. Adding a fifth favorite preserves the previous behavior by removing
// the oldest entry.
const PINNED_KEY = 'bn:pinned';
export const MAX_PINNED_SERVICES = 4;

function pinStorage(storage) { return storage || globalThis.localStorage; }

export function pinnedServices(storage) {
  try {
    const parsed = JSON.parse(pinStorage(storage)?.getItem(PINNED_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((key) => typeof key === 'string' && key))].slice(-MAX_PINNED_SERVICES);
  } catch { return []; }
}

export function isServicePinned(key, storage) { return pinnedServices(storage).includes(key); }

export function setServicePinned(key, pinned, storage) {
  const target = pinStorage(storage);
  const keys = pinnedServices(storage).filter((entry) => entry !== key);
  let removed = null;
  if (pinned) {
    if (keys.length >= MAX_PINNED_SERVICES) removed = keys.shift() || null;
    keys.push(key);
  }
  try { target?.setItem(PINNED_KEY, JSON.stringify(keys)); } catch { /* unavailable */ }
  return { keys, pinned: keys.includes(key), removed };
}

export function toggleServicePinned(key, storage) {
  return setServicePinned(key, !isServicePinned(key, storage), storage);
}

function readHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); }
  catch { return new Set(); }
}

// Reorder an existing bottom-bar favorite without changing membership.
export function movePinnedService(key, direction, storage) {
  const target = pinStorage(storage);
  const keys = pinnedServices(storage);
  const from = keys.indexOf(key);
  const to = from + (direction < 0 ? -1 : 1);
  if (from < 0 || to < 0 || to >= keys.length) return keys;
  [keys[from], keys[to]] = [keys[to], keys[from]];
  try { target?.setItem(PINNED_KEY, JSON.stringify(keys)); } catch { /* unavailable */ }
  return keys;
}

export function isHidden(key) { return readHidden().has(key); }

export function setHidden(key, hidden) {
  const s = readHidden();
  if (hidden) s.add(key); else s.delete(key);
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]));
}

function readOrder() {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); }
  catch { return []; }
}

export function setOrder(keys) { localStorage.setItem(ORDER_KEY, JSON.stringify(keys)); }

// Reorder `services` by the saved order. Services without a saved position keep
// their incoming order and are appended after the saved ones (stable sort).
export function orderServices(services) {
  const order = readOrder();
  if (!order.length) return [...services];
  const idx = new Map(order.map((k, i) => [k, i]));
  return services
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ia = idx.has(a.s.key) ? idx.get(a.s.key) : Infinity;
      const ib = idx.has(b.s.key) ? idx.get(b.s.key) : Infinity;
      return ia === ib ? a.i - b.i : ia - ib;
    })
    .map((x) => x.s);
}

// Ordered services with hidden ones removed (for nav / home display).
export function visibleServices(services) {
  return orderServices(services).filter((s) => !isHidden(s.key));
}

// Swap `key` up (-1) or down (+1) within the given ordered key list and persist.
export function moveService(orderedKeys, key, dir) {
  const arr = [...orderedKeys];
  const i = arr.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  setOrder(arr);
}
