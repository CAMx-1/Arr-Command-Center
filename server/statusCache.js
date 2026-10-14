// Cached aggregate service status.
//
// Every service is pinged in the background on an interval, and each result is
// stored as soon as that service answers. /api/status then returns instantly
// from the cache, so one slow or unreachable service (8s ping timeout) no
// longer delays the dashboard's first paint. A cold cache waits briefly for
// the fast services and leaves still-pending ones out (the UI shows them as
// "unknown" until the next poll).
export function createStatusCache({ entries, ping, intervalMs = 15000, staleMs = 10000, coldWaitMs = 1500, now = Date.now } = {}) {
  const results = new Map(); // key -> { value, at }
  let lastRun = 0;
  let running = null;
  let timer = null;

  function refresh() {
    if (running) return running;
    lastRun = now();
    const list = entries();
    const keys = new Set(list.map(([k]) => k));
    for (const k of [...results.keys()]) if (!keys.has(k)) results.delete(k); // removed services
    running = Promise.all(list.map(async ([key, svc]) => {
      const value = await ping(key, svc);
      results.set(key, { value, at: now() });
    })).finally(() => { running = null; });
    return running;
  }

  function snapshot() {
    const out = {};
    for (const [key] of entries()) { const r = results.get(key); if (r) out[key] = r.value; }
    return out;
  }

  // Cached map; kicks a background refresh when stale. On a cold cache waits
  // up to coldWaitMs (or the whole refresh when fresh=true).
  async function get({ fresh = false } = {}) {
    const keys = entries().map(([k]) => k);
    const missing = keys.some((k) => !results.has(k));
    if (fresh) { await refresh(); return snapshot(); }
    if (!running && now() - lastRun >= staleMs) refresh().catch(() => {});
    if (missing && running) {
      await Promise.race([running.catch(() => {}), new Promise((r) => setTimeout(r, coldWaitMs))]);
    }
    return snapshot();
  }

  function start() {
    if (timer) return;
    refresh().catch(() => {});
    timer = setInterval(() => { refresh().catch(() => {}); }, intervalMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  // Config changed (service added/removed/edited): drop that entry and re-poll.
  function invalidate(key) { if (key) results.delete(key); lastRun = 0; refresh().catch(() => {}); }

  return { get, refresh, start, stop, invalidate, snapshot };
}
