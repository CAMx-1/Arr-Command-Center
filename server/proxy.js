// Reverse proxy: forwards /api/proxy/<service>/<path> to the configured upstream,
// injecting the per-service API key AND the Cloudflare Access service-token headers
// (CF-Access-Client-Id / CF-Access-Client-Secret). This is the whole point of the
// backend: browsers can't safely hold these secrets or set these headers cross-origin,
// so the Node process does it.
import express from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function trimSlash(u) {
  return String(u || '').replace(/\/+$/, '');
}

// Returns { headers, query } auth additions for a given service type.
// Turn a fetch/network error into a short, human-readable reason.
function classifyUpstreamError(err) {
  if (err && err.name === 'AbortError') return 'Timed out';
  const code = err && err.cause && err.cause.code;
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN': return 'DNS: host not found';
    case 'ECONNREFUSED': return 'Connection refused';
    case 'ECONNRESET': return 'Connection reset';
    case 'ETIMEDOUT': return 'Connection timed out';
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE': return 'TLS certificate error';
    default: return String((err && err.cause && err.cause.message) || (err && err.message) || err);
  }
}

function cfHeaders(svc) {
  const h = {};
  const cf = svc.cloudflareAccess;
  if (cf && cf.clientId && cf.clientSecret) {
    h['CF-Access-Client-Id'] = cf.clientId;
    h['CF-Access-Client-Secret'] = cf.clientSecret;
  }
  return h;
}

function authFor(svc) {
  const headers = {};
  const query = {};
  const type = svc.type;

  if (type === 'sabnzbd' || type === 'tautulli' || type === 'indexer') {
    // SABnzbd, Tautulli, and Usenet indexers authenticate via ?apikey= query param.
    if (svc.apiKey) query.apikey = svc.apiKey;
  } else if (type === 'bazarr') {
    // Bazarr authenticates via the X-API-KEY header (header names are
    // case-insensitive, but Bazarr's docs use this exact casing).
    if (svc.apiKey) headers['X-API-KEY'] = svc.apiKey;
  } else if (type === 'qbittorrent') {
    // qBittorrent >= v5.2.0 supports a stateless API key via Bearer auth.
    // (Older versions use username/password cookie login — see forwardQbit.)
    if (svc.apiKey) headers['Authorization'] = `Bearer ${svc.apiKey}`;
  } else {
    // Sonarr / Radarr / Overseerr use the X-Api-Key header.
    if (svc.apiKey) headers['X-Api-Key'] = svc.apiKey;
  }

  // Cloudflare Access service token — applies to every service type.
  Object.assign(headers, cfHeaders(svc));
  return { headers, query };
}

// Stream an upstream fetch Response body straight to the Express response,
// instead of buffering the whole payload in memory via arrayBuffer(). Preserves
// the already-set status/content-type. Only content-type is copied by callers —
// upstream auth headers (set-cookie, www-authenticate, etc.) are intentionally
// NOT forwarded to the browser.
//
// `controller` is the AbortController driving the upstream fetch; if the client
// disconnects mid-stream we abort it so we don't keep pulling from the upstream.
async function pipeUpstream(upstream, res, controller) {
  if (!upstream.body) { res.end(); return; }
  const nodeStream = Readable.fromWeb(upstream.body);
  // If the client goes away before we finish, stop reading from the upstream.
  const onClose = () => { try { controller.abort(); } catch { /* ignore */ } };
  res.on('close', onClose);
  try {
    // pipeline() propagates errors/backpressure in both directions and cleans up
    // both streams (destroying the upstream reader) if either side fails.
    await pipeline(nodeStream, res);
  } catch (err) {
    try { controller.abort(); } catch { /* ignore */ }
    if (!res.writableEnded) res.destroy(err);
  } finally {
    res.off('close', onClose);
  }
}

// ---- qBittorrent authentication ----
// Two supported modes:
//   1) API key (qBittorrent >= v5.2.0): stateless `Authorization: Bearer <key>`.
//   2) username/password: we POST /api/v2/auth/login server-side, cache the
//      returned SID cookie, and re-login on 401/403.
//
// SESSION ISOLATION: the SID cookie and the in-flight login promise are keyed by
// the ROUTE service key (the identifier under which the service is configured),
// never by an ambient `svc.key` field (which is not guaranteed to exist — an
// undefined key would make every qBittorrent instance share a single cache
// entry, cross-contaminating sessions between distinct servers).
const qbitSid = new Map();     // serviceKey -> SID cookie value
const qbitPending = new Map(); // serviceKey -> in-flight login promise (de-dupe)

// Test-only helpers to inspect/reset the module-level session caches.
export function _resetQbitSessions() { qbitSid.clear(); qbitPending.clear(); }
export function _qbitSessionSnapshot() {
  return { sid: new Map(qbitSid), pending: new Map(qbitPending) };
}

async function qbitLogin(svc) {
  const base = trimSlash(svc.baseUrl);
  const body = new URLSearchParams({ username: svc.username || '', password: svc.password || '' }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let r;
  try {
    r = await fetch(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', Referer: base, Origin: base, ...cfHeaders(svc) },
      body, redirect: 'manual', signal: controller.signal,
    });
  } finally { clearTimeout(timer); }
  if (!r.ok) throw new Error(`qBittorrent login failed (HTTP ${r.status})`);
  const setCookie = r.headers.get('set-cookie') || '';
  const m = /SID=([^;]+)/.exec(setCookie);
  if (m) return m[1];
  // Some setups bypass auth for localhost and return "Ok." with no cookie.
  const text = await r.text().catch(() => '');
  if (/ok/i.test(text)) return '';
  throw new Error('qBittorrent login: no SID returned (check username/password)');
}

// Resolve (and cache) the SID for a service, keyed by the explicit `serviceKey`.
// `login` is injectable so the caching/de-dup/isolation logic can be tested
// without a live qBittorrent instance.
async function ensureQbitSid(svc, serviceKey, force = false, login = qbitLogin) {
  if (!force && qbitSid.has(serviceKey)) return qbitSid.get(serviceKey);
  if (qbitPending.has(serviceKey)) return qbitPending.get(serviceKey);
  const p = login(svc)
    .then((sid) => { qbitSid.set(serviceKey, sid); qbitPending.delete(serviceKey); return sid; })
    .catch((e) => { qbitPending.delete(serviceKey); throw e; });
  qbitPending.set(serviceKey, p);
  return p;
}
// Exported alias for regression testing of session isolation.
export { ensureQbitSid as _ensureQbitSid };

async function forwardQbit(svc, serviceKey, subPath, req, res) {
  const base = trimSlash(svc.baseUrl);
  const incomingQs = (req.originalUrl.split('?')[1]) || '';
  const cleanSub = subPath.replace(/^\/+/, '');
  const target = new URL(`${base}/${cleanSub}${incomingQs ? `?${incomingQs}` : ''}`);
  const method = req.method.toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);
  const useApiKey = !!svc.apiKey;

  // Shared controller so a client disconnect during streaming aborts the upstream.
  const controller = new AbortController();

  const doFetch = async (sid) => {
    // qBittorrent requires Referer/Origin to match the Host for its host-header check.
    const headers = { Referer: base, Origin: base, ...cfHeaders(svc) };
    if (useApiKey) headers['Authorization'] = `Bearer ${svc.apiKey}`;
    else if (sid) headers['Cookie'] = `SID=${sid}`;
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (req.headers['accept']) headers['accept'] = req.headers['accept'];
    const init = { method, headers, redirect: 'manual', signal: controller.signal };
    if (hasBody && req.body && req.body.length) init.body = req.body;
    // Header/first-byte deadline (matches prior 120s ceiling). Cleared once the
    // response headers arrive; the body is then streamed.
    const timer = setTimeout(() => controller.abort(), 120000);
    try { return await fetch(target, init); } finally { clearTimeout(timer); }
  };

  try {
    let sid = '';
    if (!useApiKey) sid = qbitSid.has(serviceKey) ? qbitSid.get(serviceKey) : await ensureQbitSid(svc, serviceKey);
    let upstream = await doFetch(sid);
    if (!useApiKey && (upstream.status === 401 || upstream.status === 403)) {
      sid = await ensureQbitSid(svc, serviceKey, true); // stale cookie — re-login once
      upstream = await doFetch(sid);
    }
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    // Stream the body; do NOT forward upstream auth/set-cookie headers.
    await pipeUpstream(upstream, res, controller);
  } catch (err) {
    if (res.headersSent) { if (!res.writableEnded) res.destroy(err); return; }
    const aborted = err.name === 'AbortError';
    const reason = classifyUpstreamError(err);
    res.status(aborted ? 504 : 502).json({ error: reason, detail: reason, service: svc.label });
  }
}

// Build the upstream URL for a service + sub-path + incoming query string.
// IMPORTANT: we preserve the client's original query string verbatim rather than
// round-tripping it through URLSearchParams. URLSearchParams re-encodes spaces as
// "+", which some upstreams (e.g. Overseerr) reject as a reserved character —
// they require "%20". Keeping the raw string avoids corrupting the encoding.
function buildTargetUrl(svc, subPath, incomingQuery) {
  const base = trimSlash(svc.baseUrl);
  const cleanSub = subPath.replace(/^\/+/, '');

  let qs = incomingQuery || '';

  // Append auth query params (e.g. SABnzbd apikey) only if not already present.
  const { query } = authFor(svc);
  const existing = new URLSearchParams(qs);
  const authPairs = [];
  for (const [k, v] of Object.entries(query)) {
    if (!existing.has(k)) authPairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  if (authPairs.length) qs = qs ? `${qs}&${authPairs.join('&')}` : authPairs.join('&');

  return new URL(`${base}/${cleanSub}${qs ? `?${qs}` : ''}`);
}

async function forward(svc, serviceKey, subPath, req, res) {
  if (svc.type === 'qbittorrent') return forwardQbit(svc, serviceKey, subPath, req, res);
  const incomingQs = (req.originalUrl.split('?')[1]) || '';
  const target = buildTargetUrl(svc, subPath, incomingQs);
  const { headers: authHeaders } = authFor(svc);

  const headers = { ...authHeaders };
  // Pass through content negotiation headers only.
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['accept']) headers['accept'] = req.headers['accept'];

  const method = req.method.toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);

  const controller = new AbortController();
  const init = {
    method,
    headers,
    redirect: 'manual',
    signal: controller.signal,
  };
  if (hasBody && req.body && req.body.length) init.body = req.body;

  // Interactive indexer searches (Sonarr/Radarr /release) can take a while as
  // they query every indexer, so allow a generous ceiling for the response
  // headers. Once headers arrive the timer is cleared and the body is streamed.
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const upstream = await fetch(target, init);
    clearTimeout(timeout);

    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    // Stream the body instead of buffering it; do NOT forward upstream
    // auth-related headers (set-cookie / www-authenticate) back to the browser.
    await pipeUpstream(upstream, res, controller);
  } catch (err) {
    clearTimeout(timeout);
    if (res.headersSent) { if (!res.writableEnded) res.destroy(err); return; }
    const aborted = err.name === 'AbortError';
    const reason = classifyUpstreamError(err);
    res.status(aborted ? 504 : 502).json({
      error: reason,
      detail: reason,
      service: svc.label,
    });
  }
}

// Ping endpoints per service type to show connection status.
const HEALTH_PATH = {
  sonarr: 'api/v3/system/status',
  radarr: 'api/v3/system/status',
  lidarr: 'api/v1/system/status',
  readarr: 'api/v1/system/status',
  overseerr: 'api/v1/status',
  sabnzbd: 'api?mode=version&output=json',
  tautulli: 'api/v2?cmd=status',
  prowlarr: 'api/v1/system/status',
  bazarr: 'api/system/status',
  qbittorrent: 'api/v2/app/version',
  indexer: 'api?t=caps&o=json',
};

// qBittorrent needs Bearer/cookie auth + Referer, so it has its own ping.
async function pingQbit(svc, serviceKey, started) {
  const base = trimSlash(svc.baseUrl);
  const useApiKey = !!svc.apiKey;
  const fetchVersion = async (sid) => {
    const headers = { Referer: base, Origin: base, ...cfHeaders(svc) };
    if (useApiKey) headers['Authorization'] = `Bearer ${svc.apiKey}`;
    else if (sid) headers['Cookie'] = `SID=${sid}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try { return await fetch(`${base}/api/v2/app/version`, { headers, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };
  try {
    let sid = '';
    if (!useApiKey) sid = await ensureQbitSid(svc, serviceKey, true);
    let u = await fetchVersion(sid);
    if (!useApiKey && (u.status === 401 || u.status === 403)) { sid = await ensureQbitSid(svc, serviceKey, true); u = await fetchVersion(sid); }
    const ms = Date.now() - started;
    let version; try { version = (await u.text()).trim(); } catch { /* ignore */ }
    const error = u.ok ? undefined : (u.status === 401 || u.status === 403) ? 'Auth / access denied' : `HTTP ${u.status}`;
    return { ok: u.ok, status: u.status, ms, version, error };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(err) };
  }
}

// Server-side authed GET returning parsed JSON. Reuses the same auth (headers +
// query apikey) and URL building as the browser proxy, so the background poller
// can call service APIs directly. `path` is the sub-path incl. any query string,
// e.g. 'api/v3/history?pageSize=25' or 'api/v1/request?filter=pending'.
export async function serviceGet(svc, path, { timeout = 10000 } = {}) {
  const [p, q] = String(path).split('?');
  const target = buildTargetUrl(svc, p, q || '');
  const { headers } = authFor(svc);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const upstream = await fetch(target, { headers: { accept: 'application/json', ...headers }, signal: controller.signal });
    const text = await upstream.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!upstream.ok) {
      const err = new Error(`HTTP ${upstream.status}`);
      err.status = upstream.status; err.body = data;
      throw err;
    }
    return data;
  } finally { clearTimeout(timer); }
}

// Server-side authed request (POST/PUT/DELETE) with optional JSON body. Used by
// the automation module to trigger searches and remove queue items.
export async function serviceRequest(svc, path, { method = 'POST', body, timeout = 15000 } = {}) {
  const [p, q] = String(path).split('?');
  const target = buildTargetUrl(svc, p, q || '');
  const { headers } = authFor(svc);
  const init = { method, headers: { accept: 'application/json', ...headers } };
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  init.signal = controller.signal;
  try {
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!upstream.ok) { const err = new Error(`HTTP ${upstream.status}`); err.status = upstream.status; err.body = data; throw err; }
    return data;
  } finally { clearTimeout(timer); }
}

export async function pingService(svc, serviceKey) {
  const started = Date.now();
  if (!svc || !svc.baseUrl) return { ok: false, status: 0, ms: 0, error: 'No base URL configured' };
  // Fall back to a stable per-service identifier so distinct services never
  // share a qBittorrent session cache entry (serviceKey should be provided by
  // callers that have it; svc.baseUrl is a safe last-resort discriminator).
  const key = serviceKey || svc.key || svc.baseUrl;
  if (svc.type === 'qbittorrent') return pingQbit(svc, key, started);
  try {
    const path = HEALTH_PATH[svc.type] || '';
    const [p, q] = path.split('?');
    const target = buildTargetUrl(svc, p, q || '');
    const { headers } = authFor(svc);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const upstream = await fetch(target, { headers: { accept: 'application/json', ...headers }, signal: controller.signal });
    clearTimeout(timeout);
    const ms = Date.now() - started;
    let version;
    try {
      const data = await upstream.json();
      version = data.version || data.settings?.version || data.data?.bazarr_version || undefined;
    } catch { /* non-json */ }
    const error = upstream.ok ? undefined
      : (upstream.status === 401 || upstream.status === 403) ? 'Auth / access denied'
      : `HTTP ${upstream.status}`;
    return { ok: upstream.ok, status: upstream.status, ms, version, error };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(err) };
  }
}

export function createProxyRouter(cfg) {
  const router = express.Router();

  // Raw body so we can forward any payload untouched.
  router.use(express.raw({ type: '*/*', limit: '25mb' }));

  router.all('/:service/*', async (req, res) => {
    const svc = cfg.services[req.params.service];
    if (!svc || svc.enabled === false) {
      return res.status(404).json({ error: `Unknown or disabled service: ${req.params.service}` });
    }
    if (!svc.baseUrl) {
      return res.status(500).json({ error: `Service ${req.params.service} has no baseUrl configured` });
    }
    const subPath = req.params[0] || '';
    await forward(svc, req.params.service, subPath, req, res);
  });

  // Allow proxying the service root as well.
  router.all('/:service', async (req, res) => {
    const svc = cfg.services[req.params.service];
    if (!svc || svc.enabled === false) {
      return res.status(404).json({ error: `Unknown or disabled service: ${req.params.service}` });
    }
    await forward(svc, req.params.service, '', req, res);
  });

  return router;
}
