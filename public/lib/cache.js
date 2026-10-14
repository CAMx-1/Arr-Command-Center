// Stale-while-revalidate cache. `cachedGet` returns cached data immediately
// (even if stale) and refreshes in the background when older than `ttl`. A single
// ticker also refreshes registered entries behind the scenes, so long-lived data
// (e.g. the Sonarr/Radarr libraries) stays warm without blocking the UI.
const store = new Map();     // key -> { data, at }
const inflight = new Map();  // key -> Promise
const jobs = new Map();      // key -> { fetcher, ttl }

// ---- Persistent layer (survives relaunches) ----
// Large, slow-changing lists (Sonarr/Radarr libraries, profiles, root folders,
// Seerr server options) are also written to IndexedDB, scoped per server +
// signed-in user. A cold launch serves them instantly and refreshes in the
// background; `acc:cache-fresh` fires when the refreshed data differs, so the
// current view can repaint.
const PERSIST_RE = /^(arr:[^:]+:(series|movie|qualityprofile|rootfolder)|seerr:service:.+|bazarr:[^:]+:profiles)$/;
const PERSIST_MAX_AGE = 7 * 86400000;
let persist = null;          // { get(id), set(id, rec), del(id), clear() }
let scope = '';

export function shouldPersist(key) { return PERSIST_RE.test(key); }
export function configurePersistence({ backend = null, scope: sc = '' } = {}) { persist = backend; scope = sc; }
const pid = (key) => `${scope}|${key}`;
const emit = (name, detail) => { try { globalThis.dispatchEvent?.(new CustomEvent(name, { detail })); } catch { /* non-DOM */ } };

async function readPersisted(key) {
  if (!persist || !shouldPersist(key)) return null;
  try {
    const rec = await persist.get(pid(key));
    if (!rec || !Number.isFinite(rec.at) || Date.now() - rec.at > PERSIST_MAX_AGE) return null;
    return rec;
  } catch { return null; }
}
function writePersisted(key, data, at) {
  if (!persist || !shouldPersist(key) || data == null) return;
  Promise.resolve().then(() => persist.set(pid(key), { data, at })).catch(() => {});
}

function run(key) {
  const job = jobs.get(key);
  if (!job || inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(job.fetcher)
    .then((data) => {
      const at = Date.now();
      const prev = store.get(key);
      store.set(key, { data, at });
      inflight.delete(key);
      writePersisted(key, data, at);
      if (prev && prev.fromDisk) {
        let changed = true;
        try { changed = JSON.stringify(prev.data) !== JSON.stringify(data); } catch { /* assume changed */ }
        emit('acc:cache-fresh', { key, changed });
      }
      return data;
    })
    .catch((err) => { inflight.delete(key); emit('acc:cache-fresh', { key, changed: false, error: true }); throw err; });
  inflight.set(key, p);
  return p;
}

export async function cachedGet(key, fetcher, ttl = 300000) {
  jobs.set(key, { fetcher, ttl }); // (re)register for background refresh
  let entry = store.get(key);
  if (!entry && !inflight.has(key)) {
    const rec = await readPersisted(key);
    if (rec && !store.has(key)) {
      entry = { data: rec.data, at: rec.at, fromDisk: true };
      store.set(key, entry);
      emit('acc:cache-stale', { key, at: rec.at });
      run(key).catch(() => {}); // always revalidate data restored from disk
      return entry.data;
    }
    entry = store.get(key);
  }
  if (entry) {
    if (Date.now() - entry.at > ttl && !inflight.has(key)) run(key).catch(() => {}); // refresh in background
    return entry.data; // serve cached immediately (stale-while-revalidate)
  }
  return run(key); // cold: fetch and cache
}

// True while any data restored from disk is still being revalidated.
export function revalidating() {
  for (const [key, e] of store) if (e.fromDisk && inflight.has(key)) return true;
  return false;
}

export async function clearPersistedCache() {
  store.clear();
  try { await persist?.clear(); } catch { /* ignore */ }
}

// IndexedDB backend (one object store, keys are scope|cacheKey).
export function indexedDbBackend(name = 'acc-cache') {
  if (typeof indexedDB === 'undefined') return null;
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction('kv', mode);
      const r = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    get: (id) => tx('readonly', (os) => os.get(id)),
    set: (id, rec) => tx('readwrite', (os) => os.put(rec, id)),
    del: (id) => tx('readwrite', (os) => os.delete(id)),
    clear: () => tx('readwrite', (os) => os.clear()),
  };
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

export function invalidate(key) {
  store.delete(key);
  if (persist && shouldPersist(key)) Promise.resolve().then(() => persist.del(pid(key))).catch(() => {});
}

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
