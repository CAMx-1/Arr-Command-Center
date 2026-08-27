// Stale-while-revalidate cache. `cachedGet` returns cached data immediately
// (even if stale) and refreshes in the background when older than `ttl`. A single
// ticker also refreshes registered entries behind the scenes, so long-lived data
// (e.g. the Sonarr/Radarr libraries) stays warm without blocking the UI.
const store = new Map();     // key -> { data, at }
const inflight = new Map();  // key -> Promise
const jobs = new Map();      // key -> { fetcher, ttl }

function run(key) {
  const job = jobs.get(key);
  if (!job || inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(job.fetcher)
    .then((data) => { store.set(key, { data, at: Date.now() }); inflight.delete(key); return data; })
    .catch((err) => { inflight.delete(key); throw err; });
  inflight.set(key, p);
  return p;
}

export async function cachedGet(key, fetcher, ttl = 300000) {
  jobs.set(key, { fetcher, ttl }); // (re)register for background refresh
  const entry = store.get(key);
  if (entry) {
    if (Date.now() - entry.at > ttl && !inflight.has(key)) run(key).catch(() => {}); // refresh in background
    return entry.data; // serve cached immediately (stale-while-revalidate)
  }
  return run(key); // cold: fetch and cache
}

export function invalidate(key) { store.delete(key); }

// Background ticker: refresh any stale registered entry so data is updated behind
// the scenes (~every ttl) even if the user doesn't revisit the page.
if (typeof window !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, { ttl }] of jobs) {
      const e = store.get(key);
      if (e && now - e.at >= ttl && !inflight.has(key)) run(key).catch(() => {});
    }
  }, 60000);
}
