// Arr Command Center — main server.
// Serves the dashboard UI and proxies API calls to your services, injecting
// per-service API keys and Cloudflare Access service-token headers.
import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, publicConfig, ALLOWED_SERVICE_TYPES, saveServiceToDisk, removeServiceFromDisk, isInsecureExposure } from './config.js';
import { createProxyRouter, pingService } from './proxy.js';
import { startMockServices } from './mock/mockServices.js';
import { createPlexAuth } from './plexAuth.js';
import * as store from './store.js';
import * as plex from './plex.js';
import * as push from './push.js';
import { startPoller, pollOnce } from './poller.js';
import * as automation from './automation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Only http/https URLs may be stored as links or service base URLs — blocks
// javascript:/data:/file: (stored XSS / local file SSRF).
function isHttpUrl(u) {
  try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; }
}

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  console.error('\n[startup] ' + err.message + '\n');
  process.exit(1);
}

// Start bundled mocks first so upstreams are ready before the app serves traffic.
let mockServers = [];
if (cfg.mock) {
  console.log('[startup] MOCK mode — starting bundled mock services:');
  mockServers = startMockServices();
}

const app = express();
app.disable('x-powered-by');

// Initialize web push (loads or generates a persistent VAPID keypair).
try { push.initPush(); } catch (e) { console.error('[push] init failed:', e.message); }

const START_TS = Date.now();
const requestLog = []; // recent /api/* requests (ring buffer) for diagnostics

// Structured request logging with request IDs + timing (for /api/* calls).
app.use((req, res, next) => {
  const id = randomUUID();
  req.id = id;
  res.set('X-Request-Id', id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.path.startsWith('/api/') || req.path === '/api/diagnostics') return;
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const entry = { id, t: Date.now(), method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms };
    requestLog.push(entry);
    if (requestLog.length > 200) requestLog.shift();
    console.log(JSON.stringify({ level: res.statusCode >= 500 ? 'error' : 'info', ...entry }));
  });
  next();
});

// Baseline security headers (safe defaults; no CSP to avoid breaking assets).
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

// Unauthenticated health endpoint (for Docker/orchestrator healthchecks).
app.get('/healthcheck', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), services: Object.keys(cfg.services).length, mock: !!cfg.mock });
});

// Optional basic auth over the whole app (UI + proxy).
if (cfg.auth && cfg.auth.enabled) {
  const expected = 'Basic ' + Buffer.from(`${cfg.auth.username}:${cfg.auth.password}`).toString('base64');
  app.use((req, res, next) => {
    if (req.headers.authorization === expected) return next();
    res.set('WWW-Authenticate', 'Basic realm="Arr Command Center"');
    return res.status(401).send('Authentication required');
  });
  console.log('[startup] Basic auth is ENABLED.');
}

// Optional "Sign in with Plex" gate.
const plexAuth = createPlexAuth(cfg, { root: ROOT, publicDir: PUBLIC_DIR });
app.use('/api/auth', plexAuth.router);
app.use(plexAuth.middleware);
if (plexAuth.enabled) console.log('[startup] Plex authentication is ENABLED.');

// Fail closed: refuse to expose the secret-injecting proxy on a public
// interface with no authentication (unless explicitly opted in).
const anyAuth = !!(cfg.auth && cfg.auth.enabled) || plexAuth.enabled;
const localOnly = cfg.host === '127.0.0.1' || cfg.host === 'localhost' || cfg.host === '::1';
if (isInsecureExposure(cfg, anyAuth)) {
  console.error(
    `\n[startup] REFUSING TO START: binding ${cfg.host} with NO authentication would expose the proxy — which injects your service API keys and Cloudflare Access tokens — to anyone who can reach this port.\n\n` +
    `Fix one of the following:\n` +
    `  • Enable auth:   set auth.plex.enabled (Sign in with Plex) or auth.enabled (basic auth) in config.json\n` +
    `  • Bind locally:  set "host": "127.0.0.1" (recommended when a reverse proxy runs on the same host)\n` +
    `  • Already protected externally (Cloudflare Access / authenticated tunnel)? Opt in explicitly with ALLOW_INSECURE=true (or "allowInsecure": true in config.json)\n`
  );
  process.exit(1);
}
if (!localOnly && !anyAuth) {
  console.warn(`[startup] WARNING: no built-in authentication; serving on ${cfg.host} because an insecure-exposure opt-in is set. Ensure an external auth layer (Cloudflare Access / authenticated tunnel) protects this port.`);
}

// Public (secret-free) config for the frontend.
app.get('/api/config', (req, res) => res.json({ ...publicConfig(cfg), auth: { plexEnabled: plexAuth.enabled, user: req.plexUser || null } }));

// Aggregate connection status for all enabled services.
app.get('/api/status', async (req, res) => {
  const entries = Object.entries(cfg.services).filter(([, s]) => s.enabled !== false);
  const results = await Promise.all(entries.map(async ([key, svc]) => {
    if (svc.sample) return [key, { label: svc.label || key, type: svc.type, ok: true, status: 200, ms: 0, version: 'sample' }];
    if (svc.type === 'plex') { const ok = plex.hasToken(cfg); return [key, { label: svc.label || key, type: 'plex', ok, status: ok ? 200 : 0, ms: 0, error: ok ? undefined : 'Sign in with Plex to enable' }]; }
    const health = await pingService(svc);
    return [key, { label: svc.label || key, type: svc.type, ...health }];
  }));
  res.json(Object.fromEntries(results));
});

// Single-service status.
app.get('/api/status/:service', async (req, res) => {
  const svc = cfg.services[req.params.service];
  if (!svc || svc.enabled === false) return res.status(404).json({ error: 'Unknown service' });
  if (svc.sample) return res.json({ label: svc.label || req.params.service, type: svc.type, ok: true, status: 200, ms: 0, version: 'sample' });
  if (svc.type === 'plex') { const ok = plex.hasToken(cfg); return res.json({ label: svc.label || req.params.service, type: 'plex', ok, status: ok ? 200 : 0, ms: 0, error: ok ? undefined : 'Sign in with Plex to enable' }); }
  res.json({ label: svc.label || req.params.service, type: svc.type, ...(await pingService(svc)) });
});

// Diagnostics: server info + recent request log (behind auth).
app.get('/api/diagnostics', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    server: {
      startedAt: START_TS,
      uptime: Math.round(process.uptime()),
      node: process.version,
      pid: process.pid,
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      mock: !!cfg.mock,
      services: Object.keys(cfg.services).length,
    },
    requests: requestLog.slice(-100).reverse(),
  });
});

// ---- Custom links (Organizr-style tabs/bookmarks). Stored in data/store.json. ----
app.get('/api/links', (req, res) => res.json(store.get('links', [])));
app.post('/api/links', express.json({ limit: '16kb' }), (req, res) => {
  const { label, url, icon, category, embed } = req.body || {};
  if (!label || !url) return res.status(400).json({ error: 'label and url are required' });
  if (!isHttpUrl(url)) return res.status(400).json({ error: 'url must be an http(s) URL' });
  if (icon && !(isHttpUrl(icon) || String(icon).startsWith('/'))) return res.status(400).json({ error: 'icon must be an http(s) URL or a local path' });
  const link = {
    id: randomUUID(),
    label: String(label).slice(0, 60),
    url: String(url).slice(0, 500),
    icon: icon ? String(icon).slice(0, 300) : '',
    category: category ? String(category).slice(0, 40) : '',
    embed: !!embed,
  };
  store.update('links', (arr) => [...(arr || []), link], []);
  res.json({ ok: true, links: store.get('links', []) });
});
app.delete('/api/links/:id', (req, res) => {
  store.update('links', (arr) => (arr || []).filter((l) => l.id !== req.params.id), []);
  res.json({ ok: true, links: store.get('links', []) });
});

// ---- Login log (recorded on Plex sign-in). ----
app.get('/api/login-log', (req, res) => res.json(store.get('loginLog', [])));

// ---- Web push (Safari/iOS + standards browsers). Behind the auth gate. ----
// The public VAPID key is needed by the browser to create a subscription.
app.get('/api/push/public-key', (req, res) => res.json({ publicKey: push.getPublicKey() }));

// Store a PushSubscription captured by the client service worker.
app.post('/api/push/subscribe', express.json({ limit: '16kb' }), (req, res) => {
  try {
    // Capture the real public origin so the VAPID contact subject is a valid
    // https URL (Apple's push service rejects invalid/.local subjects).
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol || 'https';
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (host) push.setSubject(`${proto}://${host}`);
    const sub = req.body && req.body.subscription ? req.body.subscription : req.body;
    const result = push.addSubscription(sub, { user: req.plexUser || null, ua: req.headers['user-agent'] || '' });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Remove a subscription (on disable / permission revoke).
app.post('/api/push/unsubscribe', express.json({ limit: '16kb' }), (req, res) => {
  const endpoint = req.body && (req.body.endpoint || (req.body.subscription && req.body.subscription.endpoint));
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  res.json({ ok: true, ...push.removeSubscription(endpoint) });
});

// Send a test notification to all stored subscriptions.
app.post('/api/push/test', express.json({ limit: '4kb' }), async (req, res) => {
  const { title, body } = req.body || {};
  const payload = push.notification({
    title: title || 'Arr Command Center',
    body: body || 'Push notifications are working 🎉',
    url: '/',
    tag: 'test',
  });
  try {
    const result = await push.sendToAll(payload);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Push status (subscription count) for the settings UI.
app.get('/api/push/status', (req, res) => res.json({ subscriptions: push.subscriptionCount(), subject: push.getSubject() }));

// ---- Automation: Queue Cleaner + Hunting (cross-instance). Behind auth. ----
app.get('/api/automation', (req, res) => res.json(automation.getStatus()));
app.post('/api/automation/config', express.json({ limit: '8kb' }), (req, res) => {
  res.json({ ok: true, config: automation.setConfig(req.body || {}) });
});
app.post('/api/automation/queue-cleaner/run', express.json({ limit: '2kb' }), async (req, res) => {
  try {
    const dryRun = req.body && req.body.dryRun != null ? !!req.body.dryRun : undefined;
    res.json({ ok: true, result: await automation.runQueueCleanerOnce(cfg, { dryRun }) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/automation/hunt/run', express.json({ limit: '2kb' }), async (req, res) => {
  try {
    const { mode, batchSize } = req.body || {};
    res.json({ ok: true, result: await automation.runHuntOnce(cfg, { mode, batchSize }) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Per-category notification preferences (which event types push to mobile).
app.get('/api/push/prefs', (req, res) => res.json({ categories: push.CATEGORIES, prefs: push.getPrefs() }));
app.post('/api/push/prefs', express.json({ limit: '4kb' }), (req, res) => {
  const prefs = (req.body && req.body.prefs) || req.body || {};
  res.json({ ok: true, prefs: push.setPrefs(prefs) });
});

// Manually trigger a poll now (also useful for testing). force=true pushes fresh
// events even on the very first (baseline) run.
app.post('/api/push/poll', express.json({ limit: '2kb' }), async (req, res) => {
  try {
    const force = !!(req.body && req.body.force) || req.query.force === 'true';
    const result = await pollOnce(cfg, { force });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Plex API (watchlist / users / sessions), token used server-side only. ----
app.get('/api/plex/watchlist', async (req, res) => { try { res.json(await plex.getWatchlist(cfg)); } catch (e) { res.status(502).json({ error: e.message }); } });
app.get('/api/plex/users', async (req, res) => { try { res.json(await plex.getUsers(cfg)); } catch (e) { res.status(502).json({ error: e.message }); } });
app.get('/api/plex/friends', async (req, res) => { try { res.json(await plex.getFriends(cfg)); } catch (e) { res.status(502).json({ error: e.message }); } });
app.get('/api/plex/sessions', async (req, res) => { try { res.json(await plex.getSessions(cfg)); } catch (e) { res.status(502).json({ error: e.message }); } });
app.get('/api/plex/duplicates', async (req, res) => { try { res.json(await plex.getDuplicates(cfg)); } catch (e) { res.status(502).json({ error: e.message }); } });

// Image proxy: fetches a Plex image with the token server-side (token never sent
// to the browser). Restricted to Plex hosts / the configured server to avoid SSRF.
app.get('/api/plex/image', async (req, res) => {
  const u = req.query.u;
  const token = plex.plexToken(cfg);
  if (!u || !token) return res.status(404).end();
  let target;
  try { target = new URL(u); } catch { return res.status(400).end(); }
  const serverUrl = plex.plexServerUrl(cfg) || '';
  if (!plex.isAllowedImageUrl(u, serverUrl)) return res.status(400).end();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(target, { headers: { 'X-Plex-Token': token }, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return res.status(r.status).end();
    const ct = r.headers.get('content-type'); if (ct) res.set('content-type', ct);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch { res.status(502).end(); }
});

// The proxy (handles its own raw body parsing).
app.use('/api/proxy', createProxyRouter(cfg));

// ---- Add / edit / remove a service (writes config.json). Behind auth. ----
// Note: this persists API keys / Cloudflare tokens to config.json on the server.
app.post('/api/config/service', express.json({ limit: '32kb' }), (req, res) => {
  if (cfg.mock) return res.status(400).json({ error: 'Services cannot be edited in demo mode' });
  const { key, service } = req.body || {};
  if (!key || !/^[a-z0-9_-]{1,40}$/i.test(key)) return res.status(400).json({ error: 'Invalid service key (use letters, numbers, - or _)' });
  if (!service || typeof service !== 'object') return res.status(400).json({ error: 'Missing service' });
  if (!ALLOWED_SERVICE_TYPES.includes(service.type)) return res.status(400).json({ error: `Type must be one of: ${ALLOWED_SERVICE_TYPES.join(', ')}` });
  // Build a clean service object (drop unknown fields). Blank secret fields keep
  // the existing values so editing label/type doesn't wipe the API key.
  const prev = cfg.services[key] || {};
  const clean = {
    label: String(service.label || key).slice(0, 60),
    type: service.type,
    enabled: service.enabled !== false,
  };
  const baseUrl = service.baseUrl ? String(service.baseUrl).slice(0, 300) : prev.baseUrl;
  if (service.baseUrl && !isHttpUrl(service.baseUrl)) return res.status(400).json({ error: 'baseUrl must be an http(s) URL' });
  const apiKey = service.apiKey ? String(service.apiKey).slice(0, 300) : prev.apiKey;
  if (baseUrl) clean.baseUrl = baseUrl;
  if (apiKey) clean.apiKey = apiKey;
  // qBittorrent username/password fallback (blank keeps the existing value).
  const username = service.username ? String(service.username).slice(0, 120) : prev.username;
  const password = service.password ? String(service.password).slice(0, 300) : prev.password;
  if (username) clean.username = username;
  if (password) clean.password = password;
  if (service.cloudflareAccess && (service.cloudflareAccess.clientId || service.cloudflareAccess.clientSecret)) {
    clean.cloudflareAccess = {
      clientId: String(service.cloudflareAccess.clientId || '').slice(0, 300),
      clientSecret: String(service.cloudflareAccess.clientSecret || '').slice(0, 300),
    };
  } else if (prev.cloudflareAccess) {
    clean.cloudflareAccess = prev.cloudflareAccess;
  }
  try {
    saveServiceToDisk(key, clean);
    cfg.services[key] = { ...clean }; // apply live (proxy/status read cfg.services per request)
    res.json({ ok: true, services: publicConfig(cfg).services });
  } catch (err) {
    res.status(500).json({ error: `Could not write config.json: ${err.message}` });
  }
});

app.delete('/api/config/service/:key', (req, res) => {
  if (cfg.mock) return res.status(400).json({ error: 'Services cannot be edited in demo mode' });
  const key = req.params.key;
  if (!cfg.services[key]) return res.status(404).json({ error: 'Unknown service' });
  try {
    removeServiceFromDisk(key);
    delete cfg.services[key];
    res.json({ ok: true, services: publicConfig(cfg).services });
  } catch (err) {
    res.status(500).json({ error: `Could not write config.json: ${err.message}` });
  }
});

// Static frontend. Force revalidation of HTML/CSS/JS so UI changes are picked
// up on a normal refresh (avoids stale cached views during development).
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (/\.(html|css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (/\.webmanifest$/i.test(filePath)) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
    // The service worker must be re-checked on every load and is allowed to
    // control the whole origin.
    if (/[/\\]sw\.js$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
    }
  },
}));
// SPA fallback for any non-API route.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = app.listen(cfg.port, cfg.host, () => {
  const shown = cfg.host === '0.0.0.0' ? 'localhost' : cfg.host;
  console.log(`\n  Arr Command Center running at  http://${shown}:${cfg.port}`);
  console.log(`  Services: ${Object.keys(cfg.services).join(', ')}`);
  if (cfg.mock) console.log('  Mode: DEMO (mock data)\n');
  else console.log('');
});

// Background poller for automatic push notifications. Disable with NOTIFY_DISABLE=1;
// tune cadence with NOTIFY_POLL_SECONDS (default 60, min 15).
let poller = null;
if (!process.env.NOTIFY_DISABLE) {
  poller = startPoller(cfg, { intervalSeconds: Number(process.env.NOTIFY_POLL_SECONDS) || 60 });
}

// Automation scheduler (Queue Cleaner + Hunting). Ticks every minute; each job
// only runs when enabled and its configured interval has elapsed. Disable with
// AUTOMATION_DISABLE=1.
let automationTimer = null;
if (!process.env.AUTOMATION_DISABLE) {
  automationTimer = setInterval(() => { automation.tick(cfg).catch(() => {}); }, 60000);
  if (automationTimer.unref) automationTimer.unref();
}

function shutdown() {
  console.log('\n[shutdown] closing servers...');
  if (poller) poller.stop();
  if (automationTimer) clearInterval(automationTimer);
  server.close();
  for (const s of mockServers) s.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
