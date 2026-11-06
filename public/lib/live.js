// Live refresh: re-run `fn` when the server reports that a service's queue or
// sessions changed (GET /api/live/<service>, Server-Sent Events). Falls back to
// plain polling when live updates aren't available: local-only mode, a browser
// without EventSource, a service type the server doesn't watch, or a stream
// that keeps failing. While the stream is healthy a slow safety poll still runs
// so nothing is missed if an event is dropped.
import { autoRefresh } from './ui.js';
import { isLocalMode } from './connections.js';

export const LIVE_TYPES = new Set(['sonarr', 'radarr', 'whisparr', 'lidarr', 'readarr', 'sabnzbd', 'tautulli', 'overseerr', 'jellyfin', 'emby', 'qbittorrent', 'transmission', 'deluge', 'flood', 'nzbget']);
const SAFETY_POLL_MS = 60000;
const MIN_GAP_MS = 750;

export function liveAvailable(service, { local = isLocalMode(), hasEventSource = typeof EventSource === 'function' } = {}) {
  return !!(service && LIVE_TYPES.has(service.type) && !local && hasEventSource);
}

export function liveRefresh(sentinel, service, fallbackMs, fn) {
  if (!liveAvailable(service)) return autoRefresh(sentinel, fallbackMs, fn);
  let es = null;
  let pollId = null;
  let failures = 0;
  let last = 0;
  let pending = null;
  const alive = () => sentinel && sentinel.isConnected;
  const run = () => {
    const wait = MIN_GAP_MS - (Date.now() - last);
    if (wait > 0) { if (!pending) pending = setTimeout(() => { pending = null; run(); }, wait); return; }
    last = Date.now();
    Promise.resolve(fn()).catch(() => {});
  };
  const setPoll = (ms) => {
    if (pollId) clearInterval(pollId);
    pollId = setInterval(() => { if (!alive()) return stop(); run(); }, ms);
  };
  function stop() {
    if (es) { es.close(); es = null; }
    if (pollId) { clearInterval(pollId); pollId = null; }
    if (pending) { clearTimeout(pending); pending = null; }
    document.removeEventListener('visibilitychange', onVisible);
  }
  function onVisible() { if (document.visibilityState === 'visible' && alive()) run(); }
  function open() {
    es = new EventSource(`/api/live/${encodeURIComponent(service.key)}`);
    es.addEventListener('ready', () => { failures = 0; setPoll(SAFETY_POLL_MS); });
    es.addEventListener('change', () => { if (!alive()) return stop(); run(); });
    es.addEventListener('status', (e) => {
      // The server can't reach the service: poll at the normal rate so the
      // view shows its own error/recovery promptly.
      let ok = true; try { ok = JSON.parse(e.data).ok; } catch { /* ignore */ }
      setPoll(ok ? SAFETY_POLL_MS : fallbackMs);
      if (ok) run();
    });
    es.onerror = () => {
      if (!alive()) return stop();
      failures += 1;
      setPoll(fallbackMs); // poll while the browser reconnects
      if (failures >= 3) { es.close(); es = null; } // give up on live; keep polling
    };
  }
  setPoll(fallbackMs);
  open();
  document.addEventListener('visibilitychange', onVisible);
  // Tear down when the view is replaced.
  const watch = setInterval(() => { if (!alive()) { clearInterval(watch); stop(); } }, 5000);
  return { stop };
}

// One stream for several services (Home). Calls `fn` (throttled) when any of
// them changes. Without live support nothing happens: Home has its own timer.
export function liveRefreshMany(sentinel, services, fn, { minGapMs = 2000 } = {}) {
  const list = (services || []).filter((s) => liveAvailable(s));
  if (!list.length) return null;
  const es = new EventSource(`/api/live?services=${list.map((s) => encodeURIComponent(s.key)).join(',')}`);
  let last = 0;
  let pending = null;
  let changed = new Set();
  const run = () => {
    const wait = minGapMs - (Date.now() - last);
    if (wait > 0) { if (!pending) pending = setTimeout(() => { pending = null; run(); }, wait); return; }
    last = Date.now();
    const keys = changed; changed = new Set();
    Promise.resolve(fn(keys)).catch(() => {});
  };
  let failures = 0;
  es.addEventListener('ready', () => { failures = 0; });
  es.addEventListener('change', (e) => {
    if (!sentinel || !sentinel.isConnected) return stop();
    try { const k = JSON.parse(e.data).service; if (k) changed.add(k); } catch { /* ignore */ }
    run();
  });
  es.onerror = () => { failures += 1; if (failures >= 3 || !sentinel || !sentinel.isConnected) stop(); };
  function stop() { es.close(); if (pending) clearTimeout(pending); clearInterval(watch); }
  const watch = setInterval(() => { if (!sentinel || !sentinel.isConnected) stop(); }, 5000);
  return { stop };
}
