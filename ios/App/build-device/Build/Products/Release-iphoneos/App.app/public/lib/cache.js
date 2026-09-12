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

// Fetch and cache an endpoint that must return a JSON array. A 2xx response
// with an empty/malformed body can parse as null; never retain that value or a
// Retry action will keep replaying the same poisoned cache entry.
export async function cachedList(key, fetcher, ttl = 300000, label = 'Service') {
  const data = await cachedGet(key, fetcher, ttl);
  if (Array.isArray(data)) return data;
  invalidate(key);
  throw new TypeError(`${label} returned an invalid list response`);
}

export function invalidate(key) { store.delete(key); }

// Persistent stale-while-revalidate cache for dashboard data that should survive
// reloads. Values are scoped by the caller (for example, by authenticated user)
// and stored as versioned envelopes so the format can evolve safely.
const persistentInflight = new Map();
const PERSISTENT_CACHE_VERSION = 1;

function persistentStorage(storage) { return storage || globalThis.localStorage; }

export function readPersistentCache(key, { storage, maxAge = Infinity, now = Date.now() } = {}) {
  try {
    const target = persistentStorage(storage);
    const parsed = JSON.parse(target?.getItem(key) || 'null');
    if (!parsed || parsed.v !== PERSISTENT_CACHE_VERSION || !Number.isFinite(parsed.at)) return null;
    if (now - parsed.at > maxAge) { target?.removeItem(key); return null; }
    return { data: parsed.data, at: parsed.at };
  } catch { return null; }
}

export function writePersistentCache(key, data, { storage, now = Date.now() } = {}) {
  try {
    persistentStorage(storage)?.setItem(key, JSON.stringify({ v: PERSISTENT_CACHE_VERSION, at: now, data }));
    return true;
  } catch { return false; }
}

function refreshPersistent(key, fetcher, { storage, now, validate } = {}) {
  if (persistentInflight.has(key)) return persistentInflight.get(key);
  const request = Promise.resolve().then(fetcher).then((data) => {
    if (validate && !validate(data)) throw new TypeError('Invalid cache response');
    writePersistentCache(key, data, { storage, now: now() });
    return data;
  }).finally(() => persistentInflight.delete(key));
  persistentInflight.set(key, request);
  return request;
}

// Returns cached data immediately when available. Once `ttl` elapses, `refresh`
// contains a background request that callers may use to patch the live UI. On a
// cold cache (or force=true), this waits for the fetch and returns fresh data.
export async function persistentSWR(key, fetcher, {
  ttl = 60000,
  maxAge = 86400000,
  storage,
  now = Date.now,
  validate,
  force = false,
} = {}) {
  let cached = readPersistentCache(key, { storage, maxAge, now: now() });
  if (cached && validate && !validate(cached.data)) {
    invalidatePersistentCache(key, { storage });
    cached = null;
  }
  if (cached && !force) {
    const refresh = now() - cached.at >= ttl
      ? refreshPersistent(key, fetcher, { storage, now, validate })
      : null;
    return { data: cached.data, cached: true, refresh };
  }
  const data = await refreshPersistent(key, fetcher, { storage, now, validate });
  return { data, cached: false, refresh: null };
}

export function invalidatePersistentCache(key, { storage } = {}) {
  try { persistentStorage(storage)?.removeItem(key); } catch { /* unavailable */ }
}
// Background ticker: refresh any stale registered entry behind the scenes
// (~every ttl) even if the user doesn't revisit the page.
if (typeof window !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, { ttl }] of jobs) {
      const e = store.get(key);
      if (e && now - e.at >= ttl && !inflight.has(key)) run(key).catch(() => {});
    }
  }, 60000);
}
