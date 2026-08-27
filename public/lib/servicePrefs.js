// Persisted per-service preferences: visibility (hidden) and display order.
// Affects the sidebar hive and the Home services section. Routing still works
// for hidden services if navigated to directly.
const HIDDEN_KEY = 'svc-hidden';
const ORDER_KEY = 'svc-order';

function readHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); }
  catch { return new Set(); }
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
