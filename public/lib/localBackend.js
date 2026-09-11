// Client-side "local backend": when the app is in local (direct) mode this
// intercepts its own /api/* requests so the entire existing UI keeps working
// without a server. It synthesizes /api/config and /api/status from the local
// connection store, maps /api/proxy/<key>/... to a direct request against the
// configured service (auth injected on-device), and returns empty/disabled
// responses for endpoints that inherently need the companion server.
//
// Cross-origin direct calls to services would hit CORS from the WebView, so in
// local mode those specific calls are routed through the native CapacitorHttp
// plugin (which makes the request natively, bypassing CORS). We deliberately do
// NOT enable CapacitorHttp globally: doing so patches window.fetch to use a
// native cookie jar, which breaks server mode's Cloudflare Access cookie (the
// CF_Authorization cookie set on WebView navigation isn't sent by native HTTP,
// so /api/auth/* gets 302'd to the Access login). Keeping the global fetch
// native-free preserves cookie sharing for server mode; only local-mode direct
// service calls opt into native HTTP here.
import { isLocalMode, getConnections, buildDirectRequest } from './connections.js';

let _origFetch = null;

// Native HTTP plugin accessor (present only in the Capacitor app). Used to make
// cross-origin direct service calls without tripping CORS.
function nativeHttp() {
  try {
    const cap = (typeof window !== 'undefined') && window.Capacitor;
    const p = cap && (cap.Plugins && cap.Plugins.CapacitorHttp);
    return (p && typeof p.request === 'function') ? p : null;
  } catch (e) { return null; }
}

// Perform a cross-origin service request. In the native app use CapacitorHttp
// (CORS-free); otherwise fall back to the ordinary fetch (web/PWA, same-origin
// or CORS-enabled services). Returns a standard Response so callers are agnostic.
async function directFetch(url, opts = {}) {
  const http = nativeHttp();
  if (!http) return _origFetch(url, opts);
  const method = (opts.method || 'GET').toUpperCase();
  const headers = opts.headers || {};
  let data;
  if (opts.body !== undefined && opts.body !== null) {
    const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
    if (typeof opts.body === 'string' && ct.includes('application/json')) {
      try { data = JSON.parse(opts.body); } catch { data = opts.body; }
    } else {
      data = opts.body;
    }
  }
  try {
    const res = await http.request({ url, method, headers, data });
    const body = (typeof res.data === 'string') ? res.data : JSON.stringify(res.data);
    const respHeaders = res.headers || {};
    // Normalize a content-type so downstream JSON parsing works.
    if (!respHeaders['content-type'] && !respHeaders['Content-Type'] && typeof res.data !== 'string') {
      respHeaders['content-type'] = 'application/json';
    }
    return new Response(body, { status: res.status || 200, headers: respHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e && e.message) || 'Network error' }), { status: 0, headers: { 'content-type': 'application/json' } });
  }
}
let _installed = false;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

// Synthesize the /api/config payload from local connections (matches the shape
// the server's publicConfig() returns).
export function synthConfig(connections) {
  const services = {};
  for (const [key, c] of Object.entries(connections || {})) {
    services[key] = {
      key: key,
      label: c.label || key,
      type: c.type,
      hasCloudflareAccess: !!(c.cfClientId && c.cfClientSecret),
      configured: !!c.baseUrl && !!c.apiKey,
      sample: false,
      embed: false,
      embedUrl: undefined,
    };
  }
  return { mock: false, local: true, services: services, auth: { plexEnabled: false, user: null } };
}

// Categorize a local /api path (pure — used for routing and tests).
export function classifyLocalPath(pathname) {
  if (pathname === '/api/config') return 'config';
  if (pathname === '/api/version') return 'version';
  if (pathname === '/api/status') return 'status';
  if (pathname.startsWith('/api/status/')) return 'status-one';
  if (pathname.startsWith('/api/proxy/')) return 'proxy';
  if (pathname === '/api/operations') return 'operations';
  if (pathname === '/api/links' || pathname.startsWith('/api/links/')) return 'links';
  if (pathname === '/api/login-log') return 'empty-array';
  if (pathname.startsWith('/api/config/service')) return 'config-write';
  // Features that require the host/companion server.
  if (pathname === '/api/system'
    || pathname === '/api/diagnostics'
    || pathname.startsWith('/api/plex/')
    || pathname.startsWith('/api/push/')
    || pathname.startsWith('/api/automation')) return 'server-only';
  return 'passthrough';
}

// Per-type health endpoint for status pings.
export function statusPath(type) {
  switch (type) {
    case 'lidarr': case 'readarr': return 'api/v1/system/status';
    case 'overseerr': return 'api/v1/status';
    case 'prowlarr': return 'api/v1/system/status';
    case 'sabnzbd': return 'api?mode=version&output=json';
    case 'tautulli': return 'api/v2?cmd=status';
    case 'bazarr': return 'api/system/status';
    case 'qbittorrent': return 'api/v2/app/version';
    case 'indexer': return 'api?t=caps&o=json';
    default: return 'api/v3/system/status'; // sonarr / radarr
  }
}

async function pingConnection(conn) {
  const started = Date.now();
  try {
    const { url, headers } = buildDirectRequest(`/api/proxy/${conn.key}/${statusPath(conn.type)}`, conn);
    const r = await directFetch(url, { headers: { accept: 'application/json', ...headers } });
    let version;
    try { const d = await r.clone().json(); version = d && (d.version || d.data?.version); } catch { /* non-json */ }
    const error = r.ok ? undefined : (r.status === 401 || r.status === 403) ? 'Auth / access denied' : `HTTP ${r.status}`;
    return { label: conn.label || conn.key, type: conn.type, ok: r.ok, status: r.status, ms: Date.now() - started, version, error };
  } catch (e) {
    return { label: conn.label || conn.key, type: conn.type, ok: false, status: 0, ms: Date.now() - started, error: (e && e.message) || 'unreachable' };
  }
}

function reqMethod(input, init) {
  if (init && init.method) return String(init.method).toUpperCase();
  if (input && typeof input === 'object' && input.method) return String(input.method).toUpperCase();
  return 'GET';
}
function headerVal(h, name) {
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  return h[name] || h[name.toLowerCase()] || null;
}

async function handleLocal(u, input, init) {
  const pathname = u.pathname;
  const kind = classifyLocalPath(pathname);
  const conns = getConnections();

  if (kind === 'config') return json(synthConfig(conns));
  if (kind === 'version') return json({ version: 'local', startedAt: Date.now() });
  if (kind === 'status') {
    const entries = await Promise.all(Object.values(conns).map(async (c) => [c.key, await pingConnection(c)]));
    return json(Object.fromEntries(entries));
  }
  if (kind === 'status-one') {
    const key = pathname.split('/')[3];
    const c = conns[key];
    return c ? json(await pingConnection(c)) : json({ error: 'Unknown service' }, 404);
  }
  if (kind === 'proxy') {
    const key = pathname.split('/')[3];
    const c = conns[key];
    if (!c) return json({ error: `No local connection for “${key}”. Add it in Settings.` }, 502);
    const { url, headers } = buildDirectRequest(pathname + u.search, c);
    const opts = { method: reqMethod(input, init), headers: { ...headers } };
    const src = init || (typeof input === 'object' ? input : null);
    if (src) {
      const ct = headerVal(src.headers, 'content-type'); if (ct) opts.headers['content-type'] = ct;
      const acc = headerVal(src.headers, 'accept'); if (acc) opts.headers['accept'] = acc;
      if (src.body !== undefined && src.body !== null) opts.body = src.body;
    }
    return directFetch(url, opts);
  }
  if (kind === 'operations') {
    return json({ summary: { total: 0, critical: 0, warning: 0, health: 0, missing: 0 }, inbox: [], seerr: [], seerrSummary: { requests: 0, pending: 0, issues: 0 }, activity: [] });
  }
  if (kind === 'links' || kind === 'empty-array') return json([]);
  if (kind === 'config-write') return json({ error: 'Editing services is not available in local mode' }, 400);
  if (kind === 'server-only') return json({ error: 'This feature requires the companion server', serverOnly: true }, 501);
  // passthrough — shouldn't normally happen for /api in local mode
  return _origFetch(input, init);
}

// Wrap window.fetch. In server mode it's a straight pass-through; in local mode
// it services /api/* requests locally. Non-/api requests always pass through.
export function installLocalBackend() {
  if (_installed || typeof window === 'undefined' || !window.fetch) return;
  _installed = true;
  _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      if (isLocalMode()) {
        const raw = typeof input === 'string' ? input : (input && input.url) || '';
        if (raw) {
          const u = new URL(raw, (typeof location !== 'undefined' ? location.href : 'http://localhost/'));
          if (u.pathname.startsWith('/api/')) return handleLocal(u, input, init);
        }
      }
    } catch (e) { /* fall through to network */ }
    return _origFetch(input, init);
  };
}

// Self-install on import (no-op off-DOM / in server mode).
installLocalBackend();
