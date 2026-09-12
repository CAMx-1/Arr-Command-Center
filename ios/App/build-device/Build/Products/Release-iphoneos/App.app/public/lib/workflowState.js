// Service-scoped workflow state: remembers the multi-select set (selected IDs)
// for a library so comparison/bulk selections survive a bulk round-trip or a
// navigation away and back.
//
// URL / filter / sort / scroll context is already persisted elsewhere (hash
// params via lib/urlState.js, saved views via lib/savedViews.js, and
// history-aware scroll via lib/scrollHistory.js). This module deliberately
// only owns the *selection* — the one piece of workflow state that had no home
// — and layers on top of that existing context without duplicating it.
//
// Selections are ephemeral workflow state, so they default to sessionStorage
// (per-tab, cleared when the tab closes) rather than localStorage. Everything
// goes through a safe wrapper that probes storage and silently degrades to an
// in-memory map when Web Storage is unavailable or throws (private mode,
// disabled cookies, quota exceeded) — selection must never break the view.

const PREFIX = 'acc:workflow:';

// In-memory fallback so selection still works when Web Storage throws.
const memory = new Map();

// Resolve a usable Storage, or null when none is available. An explicit
// `storage` (tests, or a caller that wants localStorage) always wins.
export function safeStorage(storage) {
  if (storage) return storage;
  try {
    const s = globalThis.sessionStorage;
    if (!s) return null;
    const probe = '__acc_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch { return null; }
}

export function scopeKey(scope) { return `${PREFIX}${String(scope || 'default')}`; }

// Normalize an id list: coerce numeric-looking ids to numbers (Sonarr/Radarr
// ids are numbers, but storage round-trips to strings), drop empties, dedupe
// while preserving first-seen order.
export function normalizeIds(ids) {
  const src = ids && typeof ids[Symbol.iterator] === 'function' ? [...ids] : [];
  const seen = new Set();
  const out = [];
  for (const raw of src) {
    if (raw === null || raw === undefined || raw === '') continue;
    const num = Number(raw);
    const id = (typeof raw !== 'boolean' && Number.isFinite(num) && String(num) === String(raw).trim()) ? num : raw;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

export function readSelection(scope, storage) {
  const store = safeStorage(storage);
  const key = scopeKey(scope);
  try {
    const raw = store ? store.getItem(key) : memory.get(key);
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? normalizeIds(value) : [];
  } catch { return []; }
}

export function writeSelection(scope, ids, storage) {
  const store = safeStorage(storage);
  const key = scopeKey(scope);
  const list = normalizeIds(ids);
  const raw = JSON.stringify(list);
  try {
    if (store) store.setItem(key, raw); else memory.set(key, raw);
  } catch { memory.set(key, raw); }
  return list;
}

export function clearSelection(scope, storage) {
  const store = safeStorage(storage);
  const key = scopeKey(scope);
  try { if (store) store.removeItem(key); else memory.delete(key); } catch { memory.delete(key); }
}

function idOf(item) { return (item && item.id !== undefined) ? item.id : item; }

// Persist the ids from a live selection (Map<id,item>, Set<id>, or array).
export function persistSelection(scope, selected, storage) {
  let ids;
  if (selected instanceof Map) ids = [...selected.keys()];
  else if (selected instanceof Set) ids = [...selected];
  else ids = selected || [];
  return writeSelection(scope, ids, storage);
}

// Rebuild a live selection Map (id -> item) from the persisted ids, intersected
// with the items currently present so stale ids (deleted/renamed) are dropped.
// Order follows the persisted id order. Pure and DOM-free for unit testing.
export function restoreSelection(scope, items, storage) {
  const ids = readSelection(scope, storage);
  const byId = new Map((items || []).map((it) => [String(idOf(it)), it]));
  const map = new Map();
  for (const id of ids) {
    const item = byId.get(String(id));
    if (item) map.set(idOf(item), item);
  }
  return map;
}
