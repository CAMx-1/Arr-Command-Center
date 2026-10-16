// Service uptime history + down/recovered alerts.
//
// Fed by the status cache after every background check (every ~15s). Keeps a
// compact per-service history of state changes (not every sample) for the
// last 7 days, computes uptime %, and raises one "down" alert after a service
// has failed for `downAfterMs` (default 2 min, so restarts/blips don't page
// you) and one "recovered" alert when it comes back.
import * as store from './store.js';

const NS = 'uptime';
const KEEP_MS = 7 * 86400000;
const MAX_CHANGES = 400;

export function createUptimeTracker({ downAfterMs = 120000, now = Date.now, onAlert = () => {}, persist = true } = {}) {
  // key -> { label, up: bool, since, changes: [[t, up]], firstSeen, alertedDown }
  const state = new Map(Object.entries(persist ? store.get(NS, {}) || {} : {}));
  let dirty = false; let lastSave = 0;

  const save = (force = false) => {
    if (!persist || !dirty) return;
    if (!force && now() - lastSave < 60000) return;
    store.set(NS, Object.fromEntries(state)); dirty = false; lastSave = now();
  };

  function prune(s, t) {
    const cutoff = t - KEEP_MS;
    // Keep the last change before the cutoff so we know the state at the window start.
    let i = 0; while (i + 1 < s.changes.length && s.changes[i + 1][0] <= cutoff) i++;
    if (i) s.changes = s.changes.slice(i);
    if (s.changes.length > MAX_CHANGES) s.changes = s.changes.slice(-MAX_CHANGES);
  }

  // Record one check result. `ok` false = down.
  function record(key, { ok, label, error }) {
    const t = now();
    let s = state.get(key);
    if (!s) { s = { label, up: !!ok, since: t, firstSeen: t, changes: [[t, !!ok]], alertedDown: false }; state.set(key, s); dirty = true; }
    s.label = label || s.label;
    if (!ok && error) s.lastError = String(error).slice(0, 200);
    if (!!ok !== s.up) {
      s.up = !!ok; s.since = t; s.changes.push([t, s.up]); dirty = true;
      if (s.up && s.alertedDown) { s.alertedDown = false; onAlert({ type: 'recovered', key, label: s.label, downFor: t - (s.changes.at(-2)?.[0] || t) }); }
    }
    if (!s.up && !s.alertedDown && t - s.since >= downAfterMs) {
      s.alertedDown = true; dirty = true;
      onAlert({ type: 'down', key, label: s.label, error: error || s.lastError, since: s.since });
    }
    prune(s, t);
    save();
  }

  function forget(key) { if (state.delete(key)) { dirty = true; save(true); } }

  // Uptime % over a window plus segments for a bar.
  function summary(key, windowMs = 86400000, buckets = 24) {
    const s = state.get(key);
    if (!s) return null;
    const t = now(); const start = Math.max(t - windowMs, s.firstSeen);
    const span = t - start;
    const upAt = (time) => { let up = s.changes[0][1]; for (const [ct, cu] of s.changes) { if (ct <= time) up = cu; else break; } return up; };
    let upMs = 0;
    const pts = [start, ...s.changes.map((c) => c[0]).filter((ct) => ct > start && ct < t), t];
    for (let i = 0; i + 1 < pts.length; i++) if (upAt(pts[i])) upMs += pts[i + 1] - pts[i];
    const bucketMs = windowMs / buckets; const bars = [];
    for (let b = 0; b < buckets; b++) {
      const bs = t - windowMs + b * bucketMs, be = bs + bucketMs;
      if (be <= s.firstSeen) { bars.push(null); continue; }
      const from = Math.max(bs, s.firstSeen);
      const anyDown = !upAt(from) || s.changes.some(([ct, cu]) => ct > from && ct < be && !cu);
      bars.push(anyDown ? 0 : 1);
    }
    return { label: s.label, up: s.up, since: s.since, uptime: span > 0 ? Math.round((upMs / span) * 10000) / 100 : 100, bars, tracked: span };
  }

  function all(windowMs, buckets) { return Object.fromEntries([...state.keys()].map((k) => [k, summary(k, windowMs, buckets)])); }
  return { record, summary, all, forget, flush: () => save(true) };
}
