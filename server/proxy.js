// Reverse proxy: forwards /api/proxy/<service>/<path> to the configured upstream,
// injecting the per-service API key AND the Cloudflare Access service-token headers
// (CF-Access-Client-Id / CF-Access-Client-Secret). This is the whole point of the
// backend: browsers can't safely hold these secrets or set these headers cross-origin,
// so the Node process does it.
import express from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomBytes } from 'node:crypto';
import { secretsFor, isTextual, createRedactor } from './redact.js';

// Every request from this module carries a service's credentials (API key
// header/query, Basic, Cloudflare Access, session cookies). Never follow
// redirects automatically: Node drops Authorization on cross-origin redirects
// but keeps custom headers (X-Api-Key, CF-Access-*) and query-string keys, so
// a redirecting upstream could collect them. Redirects reach the browser as a
// bare 3xx instead (no Location is forwarded).
const fetch = (url, init = {}) => globalThis.fetch(url, { redirect: 'manual', ...init });
import { mergeProtectedHeaders } from '../public/lib/customHeaders.js';
import { safeRpcPath, transmissionSubPath } from '../public/lib/transmissionPath.js';
import { pingTruenas } from './truenas.js';

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

function combinedHeaders(svc, generated = {}) {
  return mergeProtectedHeaders(svc.customHeaders, generated, cfHeaders(svc));
}

export const PORTAINER_ACTION_RE = /^api\/endpoints\/\d+\/docker\/containers\/[A-Za-z0-9_.-]{1,128}\/(start|stop|restart)$/;
export function isPortainerContainerAction(method, subPath) {
  return String(method).toUpperCase() === 'POST' && PORTAINER_ACTION_RE.test(String(subPath || '').replace(/^\/+/, ''));
}

// A GraphQL request that only reads: POST /graphql whose document has no
// mutation or subscription operation.
export function isUnraidQuery(method, subPath, body) {
  if (String(method).toUpperCase() !== 'POST' || String(subPath || '').replace(/^\/+|\/+$/g, '') !== 'graphql') return false;
  let doc;
  try { doc = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '')); } catch { return false; }
  const q = doc && typeof doc.query === 'string' ? doc.query : '';
  if (!q) return false;
  const stripped = q.replace(/#[^\n]*/g, '').replace(/"(?:\\.|[^"\\])*"/g, '""');
  return !/\b(mutation|subscription)\b/i.test(stripped);
}

export function subsonicAuth(svc, salt = randomBytes(8).toString('hex')) {
  return {
    u: svc.username || '',
    t: createHash('md5').update(`${svc.password || ''}${salt}`).digest('hex'),
    s: salt, v: '1.16.1', c: 'ArrCommandCenter', f: 'json',
  };
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
  } else if (type === 'transmission' || type === 'nzbget') {
    // Transmission optionally and NZBGet normally use HTTP Basic auth.
    if (svc.username || svc.password) headers.Authorization = `Basic ${Buffer.from(`${svc.username || ''}:${svc.password || ''}`).toString('base64')}`;
  } else if (type === 'deluge') {
    // Deluge Web authenticates with auth.login(password); its _session_id
    // cookie is managed by the dedicated forwarder below.
  } else if (type === 'jellyfin') {
    // Jellyfin 12 disables the legacy X-Emby-Token / api_key auth by default
    // (EnableLegacyAuthorization=false); the standard Authorization header
    // works on 10.x and 12.x.
    if (svc.apiKey) headers.Authorization = `MediaBrowser Client="Arr Command Center", Device="Server", DeviceId="arr-command-center", Version="1", Token="${svc.apiKey}"`;
  } else if (type === 'emby') {
    if (svc.apiKey) headers['X-Emby-Token'] = svc.apiKey;
  } else if (type === 'flood') {
    // Flood authenticates with a login that sets a `jwt` cookie; managed by
    // forwardFlood below.
  } else if (type === 'autobrr') {
    if (svc.apiKey) headers['X-API-Token'] = svc.apiKey;
  } else if (type === 'audiobookshelf') {
    // User API token or (v2.26+) API key, both sent as a Bearer token.
    if (svc.apiKey) headers.Authorization = `Bearer ${svc.apiKey}`;
  } else if (type === 'tdarr') {
    // Only required when Tdarr server auth is enabled.
    if (svc.apiKey) headers['x-api-key'] = svc.apiKey;
  } else if (type === 'unraid') {
    // Unraid API (7.2+, GraphQL): Settings → Management Access → API Keys.
    if (svc.apiKey) headers['x-api-key'] = svc.apiKey;
  } else if (type === 'portainer') {
    // Portainer access token (My account → Access tokens).
    if (svc.apiKey) headers['X-API-Key'] = svc.apiKey;
  } else if (type === 'syncthing') {
    if (svc.apiKey) headers['X-API-Key'] = svc.apiKey;
  } else if (type === 'pulsarr' || type === 'unpackerr') {
    if (svc.apiKey) headers['X-API-Key'] = svc.apiKey;
  } else if (type === 'speedtest') {
    // Speedtest Tracker: Bearer API token; its API only answers JSON requests.
    if (svc.apiKey) headers.Authorization = `Bearer ${svc.apiKey}`;
    headers.Accept = 'application/json';
  } else if (type === 'glances' || type === 'adguard') {
    // Glances (when started with --password) and AdGuard Home use Basic auth.
    if (svc.username || svc.password) headers.Authorization = `Basic ${Buffer.from(`${svc.username || ''}:${svc.password || ''}`).toString('base64')}`;
  } else if (type === 'navidrome') {
    // Subsonic API token auth: t = md5(password + salt), fresh salt per call.
    Object.assign(query, subsonicAuth(svc));
  } else if (type === 'pihole') {
    // Pi-hole v6 uses a session id from POST /api/auth; see forwardPihole.
  } else if (type === 'maintainerr') {
    // Maintainerr has no API authentication. Nothing to inject; access control
    // is ACC's own auth (and Cloudflare Access, if configured).
  } else {
    // Sonarr / Radarr / Overseerr use the X-Api-Key header.
    if (svc.apiKey) headers['X-Api-Key'] = svc.apiKey;
  }

  // Custom headers are additive; generated service auth and Cloudflare Access
  // are merged afterward so required credentials cannot be overridden.
  return { headers: combinedHeaders(svc, headers), query };
}

// Stream an upstream fetch Response body straight to the Express response,
// instead of buffering the whole payload in memory via arrayBuffer(). Preserves
// the already-set status/content-type. Only content-type is copied by callers —
// upstream auth headers (set-cookie, www-authenticate, etc.) are intentionally
// NOT forwarded to the browser.
//
// `controller` is the AbortController driving the upstream fetch; if the client
// disconnects mid-stream we abort it so we don't keep pulling from the upstream.
// Upstream-issued session tokens the proxy holds for a service (qBittorrent
// SID, Transmission session id, Deluge/Flood session cookies); also redacted.
function sessionTokensFor(serviceKey) {
  if (!serviceKey) return [];
  return [qbitSid, transmissionSession, delugeSession, floodSession, piholeSession]
    .map((m) => m.get(serviceKey)).filter((v) => typeof v === 'string');
}

async function pipeUpstream(upstream, res, controller, svc = null, serviceKey = '') {
  if (!upstream.body) { res.end(); return; }
  const nodeStream = Readable.fromWeb(upstream.body);
  // Text bodies are scrubbed of this service's injected credentials in case the
  // upstream reflects the request (see redact.js). Binary bodies stream as-is.
  const secrets = svc ? secretsFor(svc, sessionTokensFor(serviceKey)) : [];
  const scrub = secrets.length && isTextual(upstream.headers.get('content-type'));
  // If the client goes away before we finish, stop reading from the upstream.
  const onClose = () => { try { controller.abort(); } catch { /* ignore */ } };
  res.on('close', onClose);
  try {
    // pipeline() propagates errors/backpressure in both directions and cleans up
    // both streams (destroying the upstream reader) if either side fails.
    if (scrub) await pipeline(nodeStream, createRedactor(secrets), res);
    else await pipeline(nodeStream, res);
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
      headers: combinedHeaders(svc, { 'content-type': 'application/x-www-form-urlencoded', Referer: base, Origin: base }),
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
    const headers = combinedHeaders(svc, { Referer: base, Origin: base });
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
    await pipeUpstream(upstream, res, controller, svc, serviceKey);
  } catch (err) {
    if (res.headersSent) { if (!res.writableEnded) res.destroy(err); return; }
    const aborted = err.name === 'AbortError';
    const reason = classifyUpstreamError(err);
    res.status(aborted ? 504 : 502).json({ error: reason, detail: reason, service: svc.label });
  }
}

// ---- Transmission RPC session header -------------------------------------
// Transmission rejects a missing/stale CSRF token with HTTP 409 and returns
// the current token in X-Transmission-Session-Id. Cache by route service key
// and retry the identical request exactly once on every 409.
const transmissionSession = new Map();
export function _resetTransmissionSessions() { transmissionSession.clear(); }
export function _transmissionSessionSnapshot() { return new Map(transmissionSession); }

async function transmissionFetch(svc, serviceKey, target, init, timeoutMs = 120000) {
  const doFetch = async (sessionId) => {
    const headers = { ...(init.headers || {}) };
    if (sessionId) headers['X-Transmission-Session-Id'] = sessionId;
    const controller = init.signal ? null : new AbortController();
    const signal = init.signal || controller.signal;
    const timer = setTimeout(() => { if (controller) controller.abort(); }, timeoutMs);
    try { return await fetch(target, { ...init, headers, signal }); }
    finally { clearTimeout(timer); }
  };
  let upstream = await doFetch(transmissionSession.get(serviceKey) || '');
  if (upstream.status === 409) {
    const next = upstream.headers.get('x-transmission-session-id') || '';
    if (next) transmissionSession.set(serviceKey, next);
    try { await upstream.arrayBuffer(); } catch { /* drain before retry */ }
    if (next) upstream = await doFetch(next);
  }
  return upstream;
}

async function forwardTransmission(svc, serviceKey, subPath, req, res) {
  const incomingQs = (req.originalUrl.split('?')[1]) || '';
  const target = buildTargetUrl(svc, transmissionSubPath(subPath, svc.rpcPath), incomingQs);
  const { headers: authHeaders } = authFor(svc);
  const headers = { ...authHeaders };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['accept']) headers.accept = req.headers.accept;
  const method = req.method.toUpperCase();
  const controller = new AbortController();
  const init = { method, headers, redirect: 'manual', signal: controller.signal };
  if (!['GET', 'HEAD'].includes(method) && req.body && req.body.length) init.body = req.body;
  try {
    const timer = setTimeout(() => controller.abort(), 120000);
    let upstream;
    try { upstream = await transmissionFetch(svc, serviceKey, target, init); }
    finally { clearTimeout(timer); }
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    await pipeUpstream(upstream, res, controller, svc, serviceKey);
  } catch (err) {
    if (res.headersSent) { if (!res.writableEnded) res.destroy(err); return; }
    const reason = classifyUpstreamError(err);
    res.status(err.name === 'AbortError' ? 504 : 502).json({ error: reason, detail: reason, service: svc.label });
  }
}

// ---- Deluge Web JSON-RPC login cookie ------------------------------------
// Deluge returns authentication failures inside an HTTP-200 JSON-RPC error
// (code 1), so inspect a clone of each response, re-login, and retry once.
const delugeSession = new Map();
const delugePending = new Map();
export function _resetDelugeSessions() { delugeSession.clear(); delugePending.clear(); }
export function _delugeSessionSnapshot() { return { session: new Map(delugeSession), pending: new Map(delugePending) }; }

async function delugeLogin(svc) {
  const target = new URL(`${trimSlash(svc.baseUrl)}/json`);
  const headers = combinedHeaders(svc, { 'content-type': 'application/json', accept: 'application/json' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(target, {
      method: 'POST', headers, body: JSON.stringify({ method: 'auth.login', params: [svc.password || ''], id: 1 }),
      redirect: 'manual', signal: controller.signal,
    });
  } finally { clearTimeout(timer); }
  if (!response.ok) throw new Error(`Deluge login failed (HTTP ${response.status})`);
  const data = await response.clone().json().catch(() => null);
  if (data?.error) throw new Error(`Deluge login failed: ${data.error.message || 'JSON-RPC error'}`);
  if (data?.result !== true) throw new Error('Deluge login failed (check password)');
  const setCookie = response.headers.get('set-cookie') || '';
  const match = /(?:^|[;,]\s*)_session_id=([^;,\x00-\x1f]+)/i.exec(setCookie);
  // Auth-disabled/local-trusted deployments may return true without a cookie.
  return match ? match[1] : '';
}

async function ensureDelugeSession(svc, serviceKey, force = false, login = delugeLogin) {
  if (!force && delugeSession.has(serviceKey)) return delugeSession.get(serviceKey);
  if (delugePending.has(serviceKey)) return delugePending.get(serviceKey);
  const pending = login(svc)
    .then((cookie) => { delugeSession.set(serviceKey, cookie); delugePending.delete(serviceKey); return cookie; })
    .catch((error) => { delugePending.delete(serviceKey); throw error; });
  delugePending.set(serviceKey, pending);
  return pending;
}
export { ensureDelugeSession as _ensureDelugeSession };

async function isDelugeAuthError(response) {
  try { const data = await response.clone().json(); return Number(data?.error?.code) === 1; }
  catch { return false; }
}

async function forwardDeluge(svc, serviceKey, subPath, req, res) {
  const incomingQs = (req.originalUrl.split('?')[1]) || '';
  const target = buildTargetUrl(svc, subPath, incomingQs);
  const method = req.method.toUpperCase();
  const controller = new AbortController();
  const doFetch = async (cookie) => {
    const headers = combinedHeaders(svc, {});
    if (cookie) headers.Cookie = `_session_id=${cookie}`;
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (req.headers['accept']) headers.accept = req.headers.accept;
    const init = { method, headers, redirect: 'manual', signal: controller.signal };
    if (!['GET', 'HEAD'].includes(method) && req.body && req.body.length) init.body = req.body;
    const timer = setTimeout(() => controller.abort(), 120000);
    try { return await fetch(target, init); } finally { clearTimeout(timer); }
  };
  try {
    let cookie = delugeSession.has(serviceKey) ? delugeSession.get(serviceKey) : await ensureDelugeSession(svc, serviceKey);
    let upstream = await doFetch(cookie);
    if (await isDelugeAuthError(upstream)) {
      try { await upstream.arrayBuffer(); } catch { /* drain */ }
      cookie = await ensureDelugeSession(svc, serviceKey, true);
      upstream = await doFetch(cookie);
    }
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    await pipeUpstream(upstream, res, controller, svc, serviceKey);
  } catch (err) {
    if (res.headersSent) { if (!res.writableEnded) res.destroy(err); return; }
    const reason = classifyUpstreamError(err);
    res.status(err.name === 'AbortError' ? 504 : 502).json({ error: reason, detail: reason, service: svc.label });
  }
}


// ---- Flood login cookie ----------------------------------------------------
// POST /api/auth/authenticate {username,password} sets a `jwt` cookie (7 days).
// Cached per ROUTE service key; a 401 triggers one re-login + retry.
const floodSession = new Map();
const floodPending = new Map();
// ---- Pi-hole v6 sessions ----
// POST /api/auth { password } returns { session: { valid, sid } }; requests
// then carry X-FTL-SID. With no web password set, sid is null and no header is
// needed. Pi-hole limits concurrent sessions, so one is cached per service and
// replaced only when it expires (401).
const piholeSession = new Map();
const piholePending = new Map();
export function _resetPiholeSessions() { piholeSession.clear(); piholePending.clear(); }

async function piholeLogin(svc) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${trimSlash(svc.baseUrl)}/api/auth`, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: combinedHeaders(svc, { 'content-type': 'application/json', accept: 'application/json' }),
      body: JSON.stringify({ password: svc.password || '' }),
    });
  } finally { clearTimeout(timer); }
  const data = await response.json().catch(() => null);
  if (response.status === 401 || (data && data.session && data.session.valid === false)) throw new Error('Pi-hole login failed (check the web or app password)');
  if (!response.ok) throw new Error(`Pi-hole login failed (HTTP ${response.status})`);
  return (data && data.session && data.session.sid) || '';
}

async function ensurePiholeSession(svc, serviceKey, force = false) {
  if (!force && piholeSession.has(serviceKey)) return piholeSession.get(serviceKey);
  if (piholePending.has(serviceKey)) return piholePending.get(serviceKey);
  const pending = piholeLogin(svc)
    .then((sid) => { piholeSession.set(serviceKey, sid); piholePending.delete(serviceKey); return sid; })
    .catch((error) => { piholePending.delete(serviceKey); throw error; });
  piholePending.set(serviceKey, pending);
  return pending;
}

async function piholeFetch(svc, serviceKey, target, init, timeoutMs = 60000) {
  const controller = init.signal ? null : new AbortController();
  const run = async (sid) => {
    const headers = { ...init.headers, ...(sid ? { 'X-FTL-SID': sid } : {}) };
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try { return await fetch(target, { ...init, headers, redirect: 'manual', signal: init.signal || controller.signal }); }
    finally { if (timer) clearTimeout(timer); }
  };
  let upstream = await run(await ensurePiholeSession(svc, serviceKey));
  if (upstream.status === 401) {
    try { await upstream.arrayBuffer(); } catch { /* drain */ }
    upstream = await run(await ensurePiholeSession(svc, serviceKey, true));
  }
  return upstream;
}

async function forwardPihole(svc, serviceKey, subPath, req, res) {
  // The login route is handled here; never let the browser call it.
  if (/^api\/auth(\/|$)/i.test(subPath)) return res.status(403).json({ error: 'Pi-hole sign-in is handled by the server' });
  const incomingQs = (req.originalUrl.split('?')[1]) || '';
  const target = buildTargetUrl(svc, subPath, incomingQs);
  const method = req.method.toUpperCase();
  const controller = new AbortController();
  const headers = combinedHeaders(svc, {});
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers.accept) headers.accept = req.headers.accept;
  const init = { method, headers, signal: controller.signal };
  if (!['GET', 'HEAD'].includes(method) && req.body && req.body.length) init.body = req.body;
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const upstream = await piholeFetch(svc, serviceKey, target, init);
    clearTimeout(timer);
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    await pipeUpstream(upstream, res, controller, svc, serviceKey);
  } catch (err) {
    clearTimeout(timer);
    if (res.headersSent) { if (!res.writableEnded) res.destroy(err); return; }
    const reason = classifyUpstreamError(err);
    res.status(err.name === 'AbortError' ? 504 : 502).json({ error: reason, detail: reason, service: svc.label });
  }
}

async function pingUnraid(svc, started) {
  try {
    const { headers } = authFor(svc);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let r;
    try {
      r = await fetch(`${trimSlash(svc.baseUrl)}/graphql`, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { ...headers, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query: '{ online info { versions { core { unraid } } } }' }) });
    } finally { clearTimeout(timer); }
    const data = await r.json().catch(() => null);
    const err = data && data.errors && data.errors[0] && data.errors[0].message;
    const ok = r.ok && !err && data && data.data && data.data.online === true;
    return { ok, status: r.status, ms: Date.now() - started, version: data?.data?.info?.versions?.core?.unraid || undefined, error: ok ? undefined : (r.status === 401 || /unauth|forbidden|api key/i.test(err || '')) ? 'Auth / access denied' : err || `HTTP ${r.status}` };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(error) };
  }
}

// Authenticated Pi-hole GET returning JSON (used by the notification poller).
export async function piholeGet(svc, path) {
  const r = await piholeFetch(svc, svc.key || svc.baseUrl, new URL(`${trimSlash(svc.baseUrl)}/${path}`), { method: 'GET', headers: combinedHeaders(svc, { accept: 'application/json' }) }, 8000);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function pingPihole(svc, serviceKey, started) {
  try {
    const target = new URL(`${trimSlash(svc.baseUrl)}/api/info/version`);
    const upstream = await piholeFetch(svc, serviceKey, target, { method: 'GET', headers: combinedHeaders(svc, { accept: 'application/json' }) }, 8000);
    const data = await upstream.json().catch(() => null);
    const v = data && data.version && data.version.core && data.version.core.local && data.version.core.local.version;
    return { ok: upstream.ok, status: upstream.status, ms: Date.now() - started, version: v || undefined, error: upstream.ok ? undefined : upstream.status === 401 ? 'Auth / access denied' : `HTTP ${upstream.status}` };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(error) };
  }
}

export function _resetFloodSessions() { floodSession.clear(); floodPending.clear(); }
export function _floodSessionSnapshot() { return new Map(floodSession); }
export function _setFloodSession(key, cookie) { floodSession.set(key, cookie); }

async function floodLogin(svc) {
  const target = new URL(`${trimSlash(svc.baseUrl)}/api/auth/authenticate`);
  const headers = combinedHeaders(svc, { 'content-type': 'application/json', accept: 'application/json' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(target, {
      method: 'POST', headers, redirect: 'manual', signal: controller.signal,
      body: JSON.stringify({ username: svc.username || '', password: svc.password || '' }),
    });
  } finally { clearTimeout(timer); }
  if (response.status === 401) throw new Error('Flood login failed (check username and password)');
  if (!response.ok) throw new Error(`Flood login failed (HTTP ${response.status})`);
  const match = /(?:^|[;,]\s*)jwt=([^;,\x00-\x1f]+)/i.exec(response.headers.get('set-cookie') || '');
  if (!match) throw new Error('Flood login did not return a session cookie');
  return match[1];
}

async function ensureFloodSession(svc, serviceKey, force = false, login = floodLogin) {
  if (!force && floodSession.has(serviceKey)) return floodSession.get(serviceKey);
  if (floodPending.has(serviceKey)) return floodPending.get(serviceKey);
  const pending = login(svc)
    .then((cookie) => { floodSession.set(serviceKey, cookie); floodPending.delete(serviceKey); return cookie; })
    .catch((error) => { floodPending.delete(serviceKey); throw error; });
  floodPending.set(serviceKey, pending);
  return pending;
}

// Low-level authed Flood fetch with a single re-login on 401.
async function floodFetch(svc, serviceKey, target, init, timeoutMs = 120000) {
  const controller = init.signal ? null : new AbortController();
  const run = async (cookie) => {
    const headers = { ...init.headers, Cookie: `jwt=${cookie}` };
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try { return await fetch(target, { ...init, headers, redirect: 'manual', signal: init.signal || controller.signal }); }
    finally { if (timer) clearTimeout(timer); }
  };
  let upstream = await run(await ensureFloodSession(svc, serviceKey));
  if (upstream.status === 401) {
    try { await upstream.arrayBuffer(); } catch { /* drain */ }
    upstream = await run(await ensureFloodSession(svc, serviceKey, true));
  }
  return upstream;
}

async function forwardFlood(svc, serviceKey, subPath, req, res) {
  const incomingQs = (req.originalUrl.split('?')[1]) || '';
  const target = buildTargetUrl(svc, subPath, incomingQs);
  const method = req.method.toUpperCase();
  const controller = new AbortController();
  const headers = combinedHeaders(svc, {});
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers.accept) headers.accept = req.headers.accept;
  const init = { method, headers, signal: controller.signal };
  if (!['GET', 'HEAD'].includes(method) && req.body && req.body.length) init.body = req.body;
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const upstream = await floodFetch(svc, serviceKey, target, init);
    clearTimeout(timer);
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    await pipeUpstream(upstream, res, controller, svc, serviceKey);
  } catch (err) {
    clearTimeout(timer);
    if (res.headersSent) { if (!res.writableEnded) res.destroy(err); return; }
    const reason = classifyUpstreamError(err);
    res.status(err.name === 'AbortError' ? 504 : 502).json({ error: reason, detail: reason, service: svc.label });
  }
}

async function pingFlood(svc, serviceKey, started) {
  try {
    const target = new URL(`${trimSlash(svc.baseUrl)}/api/client/connection-test`);
    const upstream = await floodFetch(svc, serviceKey, target, { method: 'GET', headers: combinedHeaders(svc, { accept: 'application/json' }) }, 8000);
    const data = await upstream.json().catch(() => null);
    const ok = upstream.ok && data?.isConnected === true;
    return {
      ok, status: upstream.status, ms: Date.now() - started,
      error: ok ? undefined : upstream.status === 401 ? 'Auth / access denied' : upstream.ok ? 'Flood is not connected to its torrent client' : `HTTP ${upstream.status}`,
    };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(error) };
  }
}

// Tdarr: GET /api/v2/status (v2.25+), falling back to the legacy
// POST /api/v2/is-server-alive on older servers.
async function pingTdarr(svc, started) {
  const { headers } = authFor(svc);
  const base = trimSlash(svc.baseUrl);
  const call = async (path, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try { return await fetch(`${base}/${path}`, { ...init, headers: { accept: 'application/json', ...headers, ...(init.headers || {}) }, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };
  try {
    let upstream = await call('api/v2/status', { method: 'GET' });
    if (upstream.status === 404) upstream = await call('api/v2/is-server-alive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const data = await upstream.json().catch(() => null);
    const error = upstream.ok ? undefined : (upstream.status === 401 || upstream.status === 403) ? 'Auth / access denied (set the Tdarr API key)' : `HTTP ${upstream.status}`;
    return { ok: upstream.ok, status: upstream.status, ms: Date.now() - started, version: data?.version || undefined, error };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(error) };
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

const BACKUP_APPS = new Set(['sonarr', 'radarr', 'lidarr', 'readarr', 'bindery', 'prowlarr', 'whisparr', 'listenarr']);

async function forward(svc, serviceKey, subPath, req, res) {
  if (svc.type === 'qbittorrent') return forwardQbit(svc, serviceKey, subPath, req, res);
  if (svc.type === 'transmission') return forwardTransmission(svc, serviceKey, subPath, req, res);
  if (svc.type === 'deluge') return forwardDeluge(svc, serviceKey, subPath, req, res);
  if (svc.type === 'flood') return forwardFlood(svc, serviceKey, subPath, req, res);
  if (svc.type === 'pihole') return forwardPihole(svc, serviceKey, subPath, req, res);
  // Unraid is read-only here: only GraphQL queries are forwarded.
  if (svc.type === 'unraid' && !isUnraidQuery(req.method, subPath, req.body)) {
    return res.status(405).json({ error: 'Only read queries are allowed for Unraid' });
  }
  // TrueNAS speaks WebSocket JSON-RPC; the app uses /api/truenas/<key> instead.
  if (svc.type === 'truenas') return res.status(404).json({ error: 'Use /api/truenas/<service> for TrueNAS' });
  // Portainer: reads, plus start / stop / restart of a container. Nothing else
  // that could change or remove anything (create, delete, exec, update,
  // stacks, settings) is forwarded, whatever the role. Roles make the allowed
  // actions admin-only.
  if (svc.type === 'portainer' && !['GET', 'HEAD'].includes(req.method.toUpperCase()) && !isPortainerContainerAction(req.method, subPath)) {
    return res.status(405).json({ error: 'Only start, stop and restart are allowed for Portainer' });
  }
  // Backup zips are downloaded in the app itself (Settings → Backups links
  // there); they never pass through the proxy.
  if (BACKUP_APPS.has(svc.type) && /^\/*backup\//i.test(subPath)) {
    return res.status(403).json({ error: 'Download backups in the app: Settings → Backups → Open' });
  }
  const incomingQs = (req.originalUrl.split('?')[1]) || '';
  const target = buildTargetUrl(svc, subPath, incomingQs);
  const { headers: authHeaders } = authFor(svc);

  const headers = { ...authHeaders };
  // Pass through content negotiation headers only.
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['accept'] && !headers.Accept) headers['accept'] = req.headers['accept'];

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
    await pipeUpstream(upstream, res, controller, svc, serviceKey);
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
  bindery: 'api/v1/system/status',
  listenarr: 'api/v1/system/info',
  overseerr: 'api/v1/status',
  sabnzbd: 'api?mode=version&output=json',
  tautulli: 'api/v2?cmd=status',
  prowlarr: 'api/v1/system/status',
  bazarr: 'api/system/status',
  qbittorrent: 'api/v2/app/version',
  jellyfin: 'System/Info',
  emby: 'System/Info',
  audiobookshelf: 'status',
  autobrr: 'api/config',
  maintainerr: 'api/app/status',
  portainer: 'api/system/status',
  glances: 'api/4/version',
  adguard: 'control/status',
  syncthing: 'rest/system/version',
  navidrome: 'rest/ping.view',
  pulsarr: 'v1/approval/stats',
  unpackerr: 'api/stats',
  speedtest: 'api/v1/results/latest',
  whisparr: 'api/v3/system/status',
  indexer: 'api?t=caps&o=json',
};

// qBittorrent needs Bearer/cookie auth + Referer, so it has its own ping.
async function pingQbit(svc, serviceKey, started) {
  const base = trimSlash(svc.baseUrl);
  const useApiKey = !!svc.apiKey;
  const fetchVersion = async (sid) => {
    const headers = combinedHeaders(svc, { Referer: base, Origin: base });
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

async function pingTransmission(svc, serviceKey, started) {
  try {
    const target = new URL(`${trimSlash(svc.baseUrl)}${safeRpcPath(svc.rpcPath)}`);
    const { headers } = authFor(svc);
    const upstream = await transmissionFetch(svc, serviceKey, target, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ method: 'session-get', arguments: {} }), redirect: 'manual',
    }, 8000);
    const data = await upstream.json().catch(() => null);
    const rpcOk = data?.result === 'success';
    const ok = upstream.ok && rpcOk;
    return {
      ok, status: upstream.status, ms: Date.now() - started,
      version: data?.arguments?.version,
      error: ok ? undefined : upstream.status === 401 ? 'Auth / access denied' : (data?.result || `HTTP ${upstream.status}`),
    };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(error) };
  }
}

async function delugeRpc(svc, serviceKey, method, params = [], timeoutMs = 8000) {
  const target = new URL(`${trimSlash(svc.baseUrl)}/json`);
  const request = async (cookie) => {
    const headers = combinedHeaders(svc, { accept: 'application/json', 'content-type': 'application/json' });
    if (cookie) headers.Cookie = `_session_id=${cookie}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target, { method: 'POST', headers, body: JSON.stringify({ method, params, id: 2 }), signal: controller.signal });
      const data = await response.json().catch(() => null);
      return { response, data };
    } finally { clearTimeout(timer); }
  };
  let cookie = delugeSession.has(serviceKey) ? delugeSession.get(serviceKey) : await ensureDelugeSession(svc, serviceKey);
  let result = await request(cookie);
  if (Number(result.data?.error?.code) === 1) {
    cookie = await ensureDelugeSession(svc, serviceKey, true);
    result = await request(cookie);
  }
  if (!result.response.ok) throw new Error(`HTTP ${result.response.status}`);
  if (result.data?.error) throw new Error(result.data.error.message || 'Deluge JSON-RPC error');
  return result.data?.result;
}

async function pingDeluge(svc, serviceKey, started) {
  try {
    const connected = await delugeRpc(svc, serviceKey, 'web.connected');
    return { ok: connected === true, status: connected === true ? 200 : 503, ms: Date.now() - started, error: connected === true ? undefined : 'Deluge Web is not connected to a daemon' };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(error) };
  }
}

async function pingNzbget(svc, started) {
  try {
    const target = new URL(`${trimSlash(svc.baseUrl)}/jsonrpc`);
    const { headers } = authFor(svc);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(target, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', ...headers }, body: JSON.stringify({ method: 'version', params: [], id: 1 }), signal: controller.signal });
    } finally { clearTimeout(timer); }
    const data = await response.json().catch(() => null);
    const ok = response.ok && !data?.error && typeof data?.result === 'string';
    return { ok, status: response.status, ms: Date.now() - started, version: ok ? data.result : undefined, error: ok ? undefined : (response.status === 401 ? 'Auth / access denied' : data?.error?.message || `HTTP ${response.status}`) };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(error) };
  }
}

export async function pingService(svc, serviceKey) {
  const started = Date.now();
  if (!svc || !svc.baseUrl) return { ok: false, status: 0, ms: 0, error: 'No base URL configured' };
  // Fall back to a stable per-service identifier so distinct services never
  // share a qBittorrent session cache entry (serviceKey should be provided by
  // callers that have it; svc.baseUrl is a safe last-resort discriminator).
  const key = serviceKey || svc.key || svc.baseUrl;
  if (svc.type === 'qbittorrent') return pingQbit(svc, key, started);
  if (svc.type === 'transmission') return pingTransmission(svc, key, started);
  if (svc.type === 'deluge') return pingDeluge(svc, key, started);
  if (svc.type === 'nzbget') return pingNzbget(svc, started);
  if (svc.type === 'flood') return pingFlood(svc, key, started);
  if (svc.type === 'tdarr') return pingTdarr(svc, started);
  if (svc.type === 'pihole') return pingPihole(svc, key, started);
  if (svc.type === 'truenas') return pingTruenas(svc, { allowInsecure: !!svc.demoAllowInsecure });
  if (svc.type === 'unraid') return pingUnraid(svc, started);
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
    let version; let subsonicError;
    try {
      let data = await upstream.json();
      // Maintainerr's /api/app/status returns a JSON-encoded string.
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { /* plain string */ } }
      const sub = data && data['subsonic-response'];
      if (sub && sub.status !== 'ok') { subsonicError = (sub.error && sub.error.message) || 'Subsonic error'; }
      if (typeof data === 'string' && svc.type === 'glances') data = { version: data };
      version = data.version || data.Version || data.serverVersion || data.settings?.version || data.data?.bazarr_version || (sub && (sub.serverVersion || sub.version)) || undefined;
    } catch { /* non-json */ }
    if (subsonicError) return { ok: false, status: upstream.status, ms, error: subsonicError };
    const error = upstream.ok ? undefined
      : (upstream.status === 401 || upstream.status === 403) ? 'Auth / access denied'
      : (upstream.status >= 300 && upstream.status < 400)
        ? `Redirected (HTTP ${upstream.status}) — use the final URL as the base URL (e.g. https://)`
        : `HTTP ${upstream.status}`;
    return { ok: upstream.ok, status: upstream.status, ms, version, error };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, error: classifyUpstreamError(err) };
  }
}

// Server-side read of a download client's active list for live updates
// (server/live.js). Uses the same sessions/auth as the proxy for each client.
export async function liveClientFetch(svc, serviceKey) {
  const base = trimSlash(svc.baseUrl);
  const json = async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  const withTimeout = async (fn, ms = 8000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try { return await fn(controller.signal); } finally { clearTimeout(timer); }
  };
  switch (svc.type) {
    case 'qbittorrent': {
      const run = (sid) => withTimeout((signal) => {
        const headers = combinedHeaders(svc, { Referer: base, Origin: base, accept: 'application/json' });
        if (svc.apiKey) headers.Authorization = `Bearer ${svc.apiKey}`;
        else if (sid) headers.Cookie = `SID=${sid}`;
        return fetch(`${base}/api/v2/torrents/info`, { headers, redirect: 'manual', signal });
      });
      let sid = svc.apiKey ? '' : await ensureQbitSid(svc, serviceKey);
      let r = await run(sid);
      if (!svc.apiKey && (r.status === 401 || r.status === 403)) { sid = await ensureQbitSid(svc, serviceKey, true); r = await run(sid); }
      return json(r);
    }
    case 'transmission': {
      const target = new URL(`${base}${safeRpcPath(svc.rpcPath)}`);
      const { headers } = authFor(svc);
      const r = await transmissionFetch(svc, serviceKey, target, {
        method: 'POST', redirect: 'manual',
        headers: { ...headers, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'torrent-get', arguments: { fields: ['id', 'status', 'percentDone', 'error', 'rateDownload', 'rateUpload'] } }),
      }, 8000);
      return json(r);
    }
    case 'deluge':
      return delugeRpc(svc, serviceKey, 'web.update_ui', [['state', 'progress', 'download_payload_rate', 'upload_payload_rate'], {}]);
    case 'flood': {
      const r = await floodFetch(svc, serviceKey, new URL(`${base}/api/torrents`), { method: 'GET', headers: combinedHeaders(svc, { accept: 'application/json' }) }, 8000);
      return json(r);
    }
    case 'nzbget': {
      const { headers } = authFor(svc);
      const r = await withTimeout((signal) => fetch(`${base}/jsonrpc`, { method: 'POST', redirect: 'manual', signal, headers: { ...headers, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ method: 'listgroups', params: [0], id: 1 }) }));
      return json(r);
    }
    default:
      throw new Error(`No live fetch for ${svc.type}`);
  }
}

// True when any path segment is "." or ".." (after percent-decoding, repeated
// so double-encoding can't sneak one through) or contains a backslash.
export function hasDotSegment(subPath) {
  let p = String(subPath || '');
  // Decode until stable (bounded); anything still percent-encoding a dot,
  // slash or backslash after that is treated as hostile.
  for (let i = 0; i < 10; i++) { try { const d = decodeURIComponent(p); if (d === p) break; p = d; } catch { return true; } }
  if (/%(2e|2f|5c)/i.test(p)) return true;
  if (p.includes('\\')) return true;
  return p.split('/').some((seg) => seg === '.' || seg === '..');
}

// `authorize(req, svc, subPath)` may reject a request before it is forwarded;
// it returns null to allow, or { status, error } to refuse (roles).
export function createProxyRouter(cfg, { authorize } = {}) {
  const router = express.Router();
  const refused = (req, res, svc, subPath) => {
    if (!authorize) return false;
    const denial = authorize(req, svc, subPath);
    if (!denial) return false;
    res.status(denial.status || 403).json({ error: denial.error, role: denial.role });
    return true;
  };

  // Raw body so we can forward any payload untouched.
  router.use(express.raw({ type: '*/*', limit: '25mb' }));

  router.all('/:service/{*path}', async (req, res) => {
    const svc = cfg.services[req.params.service];
    if (!svc || svc.enabled === false) {
      return res.status(404).json({ error: `Unknown or disabled service: ${req.params.service}` });
    }
    if (!svc.baseUrl) {
      return res.status(500).json({ error: `Service ${req.params.service} has no baseUrl configured` });
    }
    const rawPath = req.params.path;
    const subPath = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');
    // `..` segments (literal or %2e-encoded) would let a request climb above
    // the service's base path, e.g. from https://host/sonarr to /radarr on a
    // shared reverse proxy, carrying Sonarr's injected credentials with it.
    if (hasDotSegment(subPath)) return res.status(400).json({ error: 'Invalid path' });
    if (refused(req, res, svc, subPath)) return;
    await forward(svc, req.params.service, subPath, req, res);
  });

  // Allow proxying the service root as well.
  router.all('/:service', async (req, res) => {
    const svc = cfg.services[req.params.service];
    if (!svc || svc.enabled === false) {
      return res.status(404).json({ error: `Unknown or disabled service: ${req.params.service}` });
    }
    if (refused(req, res, svc, '')) return;
    await forward(svc, req.params.service, '', req, res);
  });

  return router;
}
