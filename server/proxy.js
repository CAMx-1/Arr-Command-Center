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

function authFor(svc) {
  const headers = {};
  const query = {};
  const type = svc.type;

  if (type === 'sabnzbd' || type === 'tautulli') {
    // SABnzbd and Tautulli authenticate via ?apikey= query param.
    if (svc.apiKey) query.apikey = svc.apiKey;
  } else {
    // Sonarr / Radarr / Overseerr use the X-Api-Key header.
    if (svc.apiKey) headers['X-Api-Key'] = svc.apiKey;
  }

  // Cloudflare Access service token — applies to every service type.
  const cf = svc.cloudflareAccess;
  if (cf && cf.clientId && cf.clientSecret) {
    headers['CF-Access-Client-Id'] = cf.clientId;
    headers['CF-Access-Client-Secret'] = cf.clientSecret;
  }
  return { headers, query };
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
};

export async function pingService(svc) {
  const started = Date.now();
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
      version = data.version || data.settings?.version || undefined;
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
