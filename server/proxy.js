// Reverse proxy: forwards /api/proxy/<service>/<path> to the configured upstream,
// injecting the per-service API key AND the Cloudflare Access service-token headers
// (CF-Access-Client-Id / CF-Access-Client-Secret). This is the whole point of the
// backend: browsers can't safely hold these secrets or set these headers cross-origin,
// so the Node process does it.
import express from 'express';

function trimSlash(u) {
  return u.replace(/\/+$/, '');
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

// ---- qBittorrent authentication ----
// Two supported modes:
//   1) API key (qBittorrent >= v5.2.0): stateless `Authorization: Bearer <key>`.
//   2) username/password: we POST /api/v2/auth/login server-side, cache the
//      returned SID cookie, and re-login on 401/403.
const qbitSid = new Map();     // serviceKey -> SID cookie value
const qbitPending = new Map(); // serviceKey -> in-flight login promise (de-dupe)

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

async function ensureQbitSid(svc, force = false) {
  if (!force && qbitSid.has(svc.key)) return qbitSid.get(svc.key);
  if (qbitPending.has(svc.key)) return qbitPending.get(svc.key);
  const p = qbitLogin(svc)
    .then((sid) => { qbitSid.set(svc.key, sid); qbitPending.delete(svc.key); return sid; })
    .catch((e) => { qbitPending.delete(svc.key); throw e; });
  qbitPending.set(svc.key, p);
  return p;
}

async function forwardQbit(svc, subPath, req, res) {
  const base = trimSlash(svc.baseUrl);
  const incomingQs = (req.originalUrl.split('?')[1]) || '';
  const cleanSub = subPath.replace(/^\/+/, '');
  const target = new URL(`${base}/${cleanSub}${incomingQs ? `?${incomingQs}` : ''}`);
  const method = req.method.toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);
  const useApiKey = !!svc.apiKey;

  const doFetch = async (sid) => {
    // qBittorrent requires Referer/Origin to match the Host for its host-header check.
    const headers = { Referer: base, Origin: base, ...cfHeaders(svc) };
    if (useApiKey) headers['Authorization'] = `Bearer ${svc.apiKey}`;
    else if (sid) headers['Cookie'] = `SID=${sid}`;
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (req.headers['accept']) headers['accept'] = req.headers['accept'];
    const init = { method, headers, redirect: 'manual' };
    if (hasBody && req.body && req.body.length) init.body = req.body;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    init.signal = controller.signal;
    try { return await fetch(target, init); } finally { clearTimeout(timer); }
  };

  try {
    let sid = '';
    if (!useApiKey) sid = qbitSid.has(svc.key) ? qbitSid.get(svc.key) : await ensureQbitSid(svc);
    let upstream = await doFetch(sid);
    if (!useApiKey && (upstream.status === 401 || upstream.status === 403)) {
      sid = await ensureQbitSid(svc, true); // stale cookie — re-login once
      upstream = await doFetch(sid);
    }
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
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

async function forward(svc, subPath, req, res) {
  if (svc.type === 'qbittorrent') return forwardQbit(svc, subPath, req, res);
  const incomingQs = (req.originalUrl.split('?')[1]) || '';
  const target = buildTargetUrl(svc, subPath, incomingQs);
  const { headers: authHeaders } = authFor(svc);

  const headers = { ...authHeaders };
  // Pass through content negotiation headers only.
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['accept']) headers['accept'] = req.headers['accept'];

  const method = req.method.toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);

  const init = {
    method,
    headers,
    redirect: 'manual',
  };
  if (hasBody && req.body && req.body.length) init.body = req.body;

  const controller = new AbortController();
  // Interactive indexer searches (Sonarr/Radarr /release) can take a while as
  // they query every indexer, so allow a generous ceiling.
  const timeout = setTimeout(() => controller.abort(), 120000);
  init.signal = controller.signal;

  try {
    const upstream = await fetch(target, init);
    clearTimeout(timeout);

    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    // Prevent leaking upstream auth-related headers back to the browser.
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    clearTimeout(timeout);
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
  overseerr: 'api/v1/status',
  sabnzbd: 'api?mode=version&output=json',
  tautulli: 'api/v2?cmd=status',
  prowlarr: 'api/v1/system/status',
  bazarr: 'api/system/status',
  qbittorrent: 'api/v2/app/version',
  indexer: 'api?t=caps&o=json',
};

// qBittorrent needs Bearer/cookie auth + Referer, so it has its own ping.
async function pingQbit(svc, started) {
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
    if (!useApiKey) sid = await ensureQbitSid(svc, true);
    let u = await fetchVersion(sid);
    if (!useApiKey && (u.status === 401 || u.status === 403)) { sid = await ensureQbitSid(svc, true); u = await fetchVersion(sid); }
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

export async function pingService(svc) {
  const started = Date.now();
  if (svc.type === 'qbittorrent') return pingQbit(svc, started);
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
    await forward(svc, subPath, req, res);
  });

  // Allow proxying the service root as well.
  router.all('/:service', async (req, res) => {
    const svc = cfg.services[req.params.service];
    if (!svc || svc.enabled === false) {
      return res.status(404).json({ error: `Unknown or disabled service: ${req.params.service}` });
    }
    await forward(svc, '', req, res);
  });

  return router;
}
