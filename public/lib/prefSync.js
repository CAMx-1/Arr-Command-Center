// Settings that follow you. Theme, colour, density, pinned services, service
// order and hidden services, Home workspaces and list or hexagon views are
// saved to your account on the server (server/userPrefs.js), so every
// browser you sign in on matches.
//
// How it merges: the browser remembers the account's revision and values as
// of its last sync. A value that differs from that copy was changed here and
// is sent up; otherwise the server's value is used. The first time a browser
// syncs, the account's saved values win, and anything the account doesn't
// have yet is filled in from this browser.
import { api } from './api.js';
import { dashboardStorageKey } from './dashboardPrefs.js';

export const SYNCED = ['theme', 'accent', 'acc:density', 'bn:pinned', 'svc-hidden', 'svc-order', 'view-mode', 'activity-sources', 'upcoming-view', 'dashboards'];
const PAGE_PREFIX = 'view-mode:';
const META_KEY = 'acc:prefs-sync';
const OFF_KEY = 'acc:prefs-sync-off';
export const LABELS = {
  theme: 'theme', accent: 'colour', 'acc:density': 'density', 'bn:pinned': 'pinned services', 'svc-hidden': 'hidden services',
  'svc-order': 'service order', 'view-mode': 'list or hexagon view', 'activity-sources': 'Home activity', 'upcoming-view': 'Home upcoming view', dashboards: 'Home workspaces',
};
const labelOf = (n) => (n.startsWith(PAGE_PREFIX) ? 'page views' : LABELS[n] || n);

// Pure merge. local/snap/server are { name: value }; meta is null when this
// browser has never synced. Returns what to change here and what to send.
export function planSync({ local, meta, server }) {
  const apply = {}; const push = {};
  const sv = server.prefs || {};
  if (!meta || meta.id !== server.id) {
    for (const [n, v] of Object.entries(sv)) if (local[n] !== v) apply[n] = v;
    // A browser that has never synced fills in what the account lacks; one
    // that last synced someone else's account keeps that person's out.
    if (!meta) for (const [n, v] of Object.entries(local)) if (!(n in sv)) push[n] = v;
    return { apply, push, first: true };
  }
  const snap = meta.snap || {};
  const names = new Set([...Object.keys(local), ...Object.keys(snap), ...Object.keys(sv)]);
  for (const n of names) {
    const lv = local[n] ?? null; const sn = snap[n] ?? null; const s = sv[n] ?? null;
    if (lv !== sn) push[n] = lv; // changed here since the last sync
    else if (s !== lv) apply[n] = s; // changed on another browser
  }
  return { apply, push, first: false };
}

// Names and values present in a Storage.
export function readLocal(storage = globalThis.localStorage, dashKey = dashboardStorageKey()) {
  const out = {};
  const get = (k) => { try { return storage.getItem(k); } catch { return null; } };
  for (const n of SYNCED) { const v = get(n === 'dashboards' ? dashKey : n); if (typeof v === 'string') out[n] = v; }
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(PAGE_PREFIX)) { const v = get(k); if (typeof v === 'string') out[k] = v; }
    }
  } catch { /* unavailable */ }
  return out;
}
export function writeLocal(changes, storage = globalThis.localStorage, dashKey = dashboardStorageKey()) {
  for (const [n, v] of Object.entries(changes)) {
    const k = n === 'dashboards' ? dashKey : n;
    try { if (v === null) storage.removeItem(k); else storage.setItem(k, v); } catch { /* unavailable */ }
  }
}

const readMeta = () => { try { const m = JSON.parse(localStorage.getItem(META_KEY) || 'null'); return m && typeof m === 'object' && m.id ? m : null; } catch { return null; } };
const writeMeta = (m) => { try { if (m) localStorage.setItem(META_KEY, JSON.stringify(m)); else localStorage.removeItem(META_KEY); } catch { /* unavailable */ } };
export const syncOffHere = () => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; } };

let started = false;
let chain = Promise.resolve();
let lastPull = 0;
let timer = null;
let status = { available: null };
let appliedHook = () => {};
const queue = (fn) => (chain = chain.then(fn).catch(() => {}));
const listeners = new Set();
const announce = () => { for (const fn of listeners) { try { fn(status); } catch { /* ignore */ } } };
export const syncStatus = () => status;
export function onSyncStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Apply values from the server and tell the app what changed.
function applyHere(changes, onApplied) {
  if (!Object.keys(changes).length) return;
  writeLocal(changes);
  onApplied(Object.keys(changes));
}

async function send(meta, push) {
  try {
    const d = await api.sendJson('/api/account/prefs', { rev: meta.rev, set: push }, 'PUT');
    writeMeta({ id: d.id, rev: d.rev, snap: d.prefs });
    status = { ...status, available: true, who: d.who, at: d.at };
    return true;
  } catch (e) {
    if (e.data && e.data.conflict) return false; // another browser saved first; merge again
    throw e;
  }
}

// Full sync: fetch the account's copy, merge, send what changed here.
async function syncNow(onApplied, { tries = 3 } = {}) {
  if (syncOffHere()) return;
  const server = await api.getJson('/api/account/prefs');
  lastPull = Date.now();
  if (!server.available) { status = { available: false, reason: server.reason }; announce(); return; }
  const plan = planSync({ local: readLocal(), meta: readMeta(), server });
  applyHere(plan.apply, (names) => onApplied(names, plan.first));
  // This browser now agrees with the server, apart from what it sends next.
  writeMeta({ id: server.id, rev: server.rev, snap: server.prefs });
  status = { available: true, who: server.who, at: server.at };
  if (Object.keys(plan.push).length && !(await send(readMeta(), plan.push)) && tries > 1) return syncNow(onApplied, { tries: tries - 1 });
  announce();
}

// Send local changes (no fetch unless another browser saved in between).
async function pushNow(onApplied) {
  if (syncOffHere()) return;
  const meta = readMeta();
  if (!meta) return syncNow(onApplied);
  const local = readLocal(); const push = {};
  for (const n of new Set([...Object.keys(local), ...Object.keys(meta.snap || {})])) {
    const lv = local[n] ?? null; if (lv !== ((meta.snap || {})[n] ?? null)) push[n] = lv;
  }
  if (!Object.keys(push).length) return;
  if (!(await send(meta, push))) return syncNow(onApplied);
  announce();
}

// Start syncing. onApplied(names, first) runs after values from the server
// were written here, so the app can repaint. Resolves after the first sync
// or after `waitMs`, whichever is sooner, so a slow server doesn't hold up
// the first screen.
export function startPrefSync({ onApplied = () => {}, waitMs = 1500 } = {}) {
  if (started) return Promise.resolve();
  started = true;
  appliedHook = onApplied;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => queue(() => pushNow(onApplied)), 700); };
  window.addEventListener('acc:prefs-changed', schedule);
  window.addEventListener('acc:appearance', schedule);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(timer); queue(() => pushNow(onApplied)); }
    else if (Date.now() - lastPull > 30000) queue(() => syncNow(onApplied));
  });
  const first = queue(() => syncNow(onApplied));
  return Promise.race([first, new Promise((r) => setTimeout(r, waitMs))]);
}

// The switch in Settings. Off: this browser keeps its own settings. Back on:
// the account's saved values are used again (nothing here is sent up over
// them).
export function setSyncHere(on, onApplied = appliedHook) {
  try { if (on) localStorage.removeItem(OFF_KEY); else localStorage.setItem(OFF_KEY, '1'); } catch { /* unavailable */ }
  writeMeta(null);
  if (on) return queue(() => syncNow(onApplied));
  status = { ...status }; announce();
  return Promise.resolve();
}

export const describeNames = (names) => [...new Set(names.map(labelOf))].join(', ');
