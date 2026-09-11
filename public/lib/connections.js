// Local ("direct") mode: the app talks straight to your services from the
// device — credentials stored locally, no backend proxy. Scoped to Sonarr for
// now, but structured (authFor / buildDirectRequest handle every service type)
// to extend to the rest.
//
// All state is in localStorage; every reader accepts an injectable storage so
// the pure logic is unit-testable off-DOM.

const MODE_KEY = 'acc:app-mode';     // 'server' | 'local'
const CONN_KEY = 'acc:connections';  // { <key>: { key, type, label, baseUrl, apiKey, cfClientId, cfClientSecret } }

const storageFor = (s) => s || globalThis.localStorage;
const trimSlash = (u) => String(u || '').replace(/\/+$/, '');

// Service types that can currently run in local mode.
export const LOCAL_SUPPORTED = ['sonarr'];

export function getAppMode(storage) {
  try { return storageFor(storage).getItem(MODE_KEY) === 'local' ? 'local' : 'server'; }
  catch { return 'server'; }
}
export function setAppMode(mode, storage) {
  const m = mode === 'local' ? 'local' : 'server';
  try { storageFor(storage).setItem(MODE_KEY, m); } catch { /* ignore */ }
  return m;
}
export function isLocalMode(storage) { return getAppMode(storage) === 'local'; }

export function getConnections(storage) {
  try {
    const v = JSON.parse(storageFor(storage).getItem(CONN_KEY) || 'null');
    return (v && typeof v === 'object') ? v : {};
  } catch { return {}; }
}
export function getConnection(key, storage) { return getConnections(storage)[key] || null; }
export function setConnection(key, conn, storage) {
  const all = getConnections(storage);
  all[key] = { key: key, ...conn };
  try { storageFor(storage).setItem(CONN_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  return all[key];
}
export function removeConnection(key, storage) {
  const all = getConnections(storage);
  delete all[key];
  try { storageFor(storage).setItem(CONN_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  return all;
}

// Auth to inject for a direct request, by service type. Mirrors the server's
// proxy authFor(): returns { headers, query } to add.
export function authFor(conn) {
  const headers = {};
  const query = {};
  const type = conn && conn.type;
  if (type === 'sabnzbd' || type === 'tautulli' || type === 'indexer') {
    if (conn.apiKey) query.apikey = conn.apiKey;
  } else if (type === 'bazarr') {
    if (conn.apiKey) headers['X-API-KEY'] = conn.apiKey;
  } else if (type === 'qbittorrent') {
    if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;
  } else {
    // sonarr / radarr / lidarr / readarr / overseerr / prowlarr
    if (conn && conn.apiKey) headers['X-Api-Key'] = conn.apiKey;
  }
  if (conn && conn.cfClientId && conn.cfClientSecret) {
    headers['CF-Access-Client-Id'] = conn.cfClientId;
    headers['CF-Access-Client-Secret'] = conn.cfClientSecret;
  }
  return { headers, query };
}

// Map a proxy path ("/api/proxy/<key>/<upstream>?<qs>") to a direct request
// against the connection's baseUrl, injecting auth. Pure — returns { url, headers }.
// The raw query string is preserved (only missing auth params are appended), so
// encodings some upstreams are picky about aren't corrupted.
export function buildDirectRequest(proxyPath, conn) {
  const parts = String(proxyPath).split(/\?(.*)/s);
  const pathOnly = parts[0];
  const rawQs = parts[1] || '';
  const m = pathOnly.match(/^\/api\/proxy\/[^/]+\/(.*)$/);
  const upstream = m ? m[1] : pathOnly.replace(/^\/+/, '');
  const base = trimSlash(conn.baseUrl);
  const { headers, query } = authFor(conn);
  const existing = new URLSearchParams(rawQs);
  const authPairs = [];
  for (const [k, v] of Object.entries(query)) {
    if (!existing.has(k)) authPairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  let qs = rawQs;
  if (authPairs.length) qs = qs ? `${qs}&${authPairs.join('&')}` : authPairs.join('&');
  const url = `${base}/${upstream}${qs ? `?${qs}` : ''}`;
  return { url, headers };
}
