// Arr Command Center — main server.
// Serves the dashboard UI and proxies API calls to your services, injecting
// per-service API keys and Cloudflare Access service-token headers.
import express from 'express';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, publicConfig, localFallbackConfig, ALLOWED_SERVICE_TYPES, saveServiceToDisk, removeServiceFromDisk, configWritable, createServiceWriter, isInsecureExposure, buildServiceUpdate } from './config.js';
import { createProxyRouter, pingService, serviceRequest, serviceGet, liveClientFetch, qbitApi } from './proxy.js';
import { startMockServices } from './mock/mockServices.js';
import { createPlexAuth } from './plexAuth.js';
import * as store from './store.js';
import * as plex from './plex.js';
import * as push from './push.js';
import * as channels from './channels.js';
import { startPoller, pollOnce } from './poller.js';
import { createInsightsRecorder, seedDemoHistory } from './insights.js';
import { createDiskRecorder, forecastDisks, seedDemoDiskHistory, DISK_NS } from './diskForecast.js';
import { loadSpacePlan } from './spacePlanner.js';
import { mediaMismatches, matchCandidates, applyMatch, loadMediaTranscodes } from './mediaServerTools.js';
import { runDoctor } from './setupDoctor.js';
import { runCompat } from './compatCheck.js';
import { createStepUp } from './stepUp.js';
import { createUserPrefs } from './userPrefs.js';
import { createYearReview } from './yearReview.js';
import { createSelfBackup } from './selfBackup.js';
import { createActivityLog } from './activity.js';
import { createServiceAccess, pushFilter } from './serviceAccess.js';
import { discover, cleanHosts, localSubnets, DEFAULT_PORTS, freeKey } from './discovery.js';
import { createIndexerSend } from './indexerSend.js';
import { createWebhooks, debounced, arrWebhookNotification, qbitPrefsPlan, qbitCommand } from './webhooks.js';
import { createDigest, describeSchedule } from './digest.js';
import { createBotCore, createTelegramPoller, createDiscordHandler, publicBot, applyBotSettings, upsertBotUser } from './chatBot.js';
import * as automation from './automation.js';
import { getOperations } from './operations.js';
import { getSystemStats } from './system.js';
import { createAssetServer } from './assets.js';
import { createStatusCache } from './statusCache.js';
import { createUptimeTracker } from './uptime.js';
import { createActionTokens } from './actionTokens.js';
import { safeEqual, createAuthLimiter } from './authGuard.js';
import { createRoleGuard, mountUserRoutes } from './roleRoutes.js';
import { createLiveHub } from './live.js';
import { truenasOverview } from './truenas.js';
import { createTrashSource, demoTrashSource } from './trash.js';

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
// gzip/brotli for HTML/CSS/JS/JSON (library lists shrink ~5-10x). Responses
// that already carry a Content-Encoding are left alone.
app.use(compression());

// Initialize web push (loads or generates a persistent VAPID keypair).
try { push.initPush(); } catch (e) { console.error('[push] init failed:', e.message); }

const START_TS = Date.now();
const requestLog = []; // recent /api/* requests (ring buffer) for diagnostics

// Stable build identity for the running server. Used by the frontend's update
// banner: when this value changes (a new deploy), connected clients are told to
// reload. It stays constant across mere restarts of the same build so a restart
// doesn't nag users. Override with BUILD_ID; otherwise derived from the package
// version plus the mtimes of the primary shipped assets.
const BUILD_ID = computeBuildId();
function computeBuildId() {
  if (process.env.BUILD_ID) return String(process.env.BUILD_ID).slice(0, 64);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const files = [
      path.join(PUBLIC_DIR, 'app.js'),
      path.join(PUBLIC_DIR, 'styles.css'),
      path.join(PUBLIC_DIR, 'index.html'),
      path.join(__dirname, 'index.js'),
    ];
    const hash = createHash('sha1');
    hash.update(String(pkg.version || '0'));
    for (const f of files) { try { hash.update(String(fs.statSync(f).mtimeMs)); } catch { /* missing file — skip */ } }
    return `${pkg.version || '0'}-${hash.digest('hex').slice(0, 12)}`;
  } catch { return 'dev'; }
}

// Structured request logging with request IDs + timing (for /api/* calls).
app.use((req, res, next) => {
  const id = randomUUID();
  req.id = id;
  res.set('X-Request-Id', id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.path.startsWith('/api/') || req.path === '/api/diagnostics') return;
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const entry = { id, t: Date.now(), method: req.method, path: req.originalUrl.split('?')[0].replace(/^(\/api\/hooks\/[^/]+\/).+$/, '$1…'), status: res.statusCode, ms };
    requestLog.push(entry);
    if (requestLog.length > 200) requestLog.shift();
    console.log(JSON.stringify({ level: res.statusCode >= 500 ? 'error' : 'info', ...entry }));
  });
  next();
});

// Baseline security headers. The app intentionally permits http(s) connections
// and frames because users configure self-hosted LAN services; scripts remain
// same-origin and plugins/objects are blocked.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "connect-src 'self' https: http: wss: ws:",
    "frame-src https: http:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https:",
    "frame-ancestors 'self'",
  ].join('; '));
  next();
});

// Unauthenticated health endpoint (for Docker/orchestrator healthchecks).
// ---- Notification action buttons (ntfy Approve/Decline) ----
// Runs BEFORE the auth gate: the caller is the ntfy app/server, not a signed-in
// browser. Authorization is the signed, single-use, expiring token, scoped to
// one Seerr request + action (see actionTokens.js). Disabled unless the server
// knows its public URL (PUBLIC_URL, or the https origin captured for push).
const actionSecret = process.env.ACTION_SECRET || (() => {
  let k = store.get('actionSecret', null);
  if (!k) { k = randomUUID() + randomUUID(); store.set('actionSecret', k); }
  return k;
})();
const actionTokens = createActionTokens({ secret: actionSecret, persist: !cfg.mock });
function publicBaseUrl() {
  const clean = (u) => String(u).replace(/\/+$/, "");
  const env = process.env.PUBLIC_URL;
  if (env && (env.startsWith("https://") || env.startsWith("http://"))) return clean(env);
  const subj = push.getSubject && push.getSubject();
  return subj && subj.startsWith("https://") && !subj.includes("localhost") ? clean(subj) : null;
}
function actionsFor(e) {
  const base = publicBaseUrl();
  if (!base || !e.action) return null;
  const mk = (action, label) => ({ label, url: `${base}/api/notify/action/${actionTokens.issue({ ...e.action, action })}` });
  return [mk('approve', 'Approve'), mk('decline', 'Decline')];
}
const actionLimiter = createAuthLimiter({ maxFailures: 20, windowMs: 10 * 60000, baseLockMs: 5 * 60000 });
// Chat requests. Discord calls this endpoint itself (no dashboard session),
// so it sits before sign-in; every call must carry a valid Discord signature.
const bot = createBotCore({ cfg, store });
// TELEGRAM_API_BASE lets you use a self-hosted Telegram Bot API server.
const telegramBot = createTelegramPoller({ core: bot, apiBase: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org', onError: (e) => console.warn('[bot] telegram:', e.message) });
const discordBot = createDiscordHandler({ core: bot });
// Webhooks from Sonarr/Radarr/Seerr/Tautulli (no session: the per-service
// token in the URL is the secret). Wrong tokens count toward a lockout.
const pollSoon = debounced(() => { if (poller) poller.tick().catch(() => {}); });
const webhooks = createWebhooks({ cfg, store, onEvent: ({ key }) => { try { liveHub.nudge(key); } catch { /* not started */ } pollSoon(); } });
const hookLimiter = createAuthLimiter({ maxFailures: 30, windowMs: 10 * 60000, baseLockMs: 5 * 60000 });
app.post('/api/hooks/:key/:token', (req, res, next) => {
  const client = req.socket.remoteAddress || 'unknown';
  if (hookLimiter.blockedFor(client)) return res.status(429).json({ error: 'Too many attempts' });
  res.on('finish', () => { if (res.statusCode === 404) hookLimiter.fail(client); });
  next();
}, express.json({ limit: '256kb', type: () => true }), (err, req, res, next) => (err ? res.status(400).json({ error: 'Bad JSON' }) : next()), webhooks.receive);

app.post('/api/bot/discord/interactions', express.raw({ type: '*/*', limit: '64kb' }), (req, res) => { discordBot.interactions(req, res).catch(() => { if (!res.headersSent) res.status(500).end(); }); });

app.post('/api/notify/action/:token', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const client = req.socket.remoteAddress || 'unknown';
  if (actionLimiter.blockedFor(client)) return res.status(429).json({ error: 'Too many attempts' });
  const r = actionTokens.redeem(req.params.token, cfg.services);
  if (!r.ok) { actionLimiter.fail(client); return res.status(r.error === 'invalid' ? 403 : 410).json({ error: `Link ${r.error}` }); }
  const { s: key, r: id, a: action } = r.payload;
  try {
    await serviceRequest(cfg.services[key], `api/v1/request/${id}/${action}`, { method: 'POST' });
    res.json({ ok: true, message: action === 'approve' ? 'Request approved' : 'Request declined' });
  } catch (e) {
    res.status(502).json({ error: `Seerr: ${(e && e.message) || 'request failed'}`.slice(0, 200) });
  }
});

app.get('/healthcheck', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), services: Object.keys(cfg.services).length, mock: !!cfg.mock });
});

// Optional basic auth over the whole app (UI + proxy).
if (cfg.auth && cfg.auth.enabled) {
  const expected = 'Basic ' + Buffer.from(`${cfg.auth.username}:${cfg.auth.password}`).toString('base64');
  // Constant-time compare + per-client lockout after repeated failures.
  // Keyed by socket address (trust proxy is off, so this can't be spoofed via
  // X-Forwarded-For; behind a reverse proxy all clients share one bucket,
  // which still caps guessing).
  const limiter = createAuthLimiter();
  app.use((req, res, next) => {
    const client = req.socket.remoteAddress || 'unknown';
    const wait = limiter.blockedFor(client);
    if (wait) {
      res.set('Retry-After', String(Math.ceil(wait / 1000)));
      return res.status(429).send('Too many failed sign-in attempts. Try again later.');
    }
    const given = req.headers.authorization;
    if (typeof given === 'string' && safeEqual(given, expected)) { limiter.succeed(client); return next(); }
    if (given) limiter.fail(client); // a missing header is the browser's first probe, not a guess
    res.set('WWW-Authenticate', 'Basic realm="Arr Command Center"');
    return res.status(401).send('Authentication required');
  });
  console.log('[startup] Basic auth is ENABLED.');
}

// Optional "Sign in with Plex" gate.
// A sign-in from a browser the account hasn't used before: tell that person
// on their own devices (push), and an admin's alerts also go to the
// notification channels (which belong to the admins).
const lcName = (v) => String(v || '').toLowerCase();
function signInAlert({ user, email, role, device, ip }) {
  const msg = { title: 'New sign-in to Arr Command Center', body: `${user} signed in on ${device}${ip ? ` from ${ip}` : ''}. If this wasn’t you, open Settings → Sign-in & security and sign that session out.`, url: '/#/settings?tab=you&open=security', category: 'security' };
  if (push.categoryEnabled('security')) {
    const mine = [user, email].filter(Boolean).map(lcName);
    push.sendToAll(push.notification({ title: msg.title, body: msg.body, url: msg.url, tag: `signin:${Date.now()}` }), { filter: (sub) => [sub.user, sub.email].filter(Boolean).some((v) => mine.includes(lcName(v))) }).catch(() => {});
  }
  if (role === 'admin') channels.sendToChannels(msg, { globalEnabled: (c) => push.categoryEnabled(c) }).catch(() => {});
}
const plexAuth = createPlexAuth(cfg, { root: ROOT, publicDir: PUBLIC_DIR, onNewDevice: signInAlert });
// "Confirm it's you" before deleting files or changing roles (two-factor accounts).
const stepUp = createStepUp(plexAuth);
app.use('/api/auth', plexAuth.router);
app.use(plexAuth.middleware);
if (plexAuth.enabled) console.log('[startup] Plex authentication is ENABLED.');
// Roles: every /api request is checked against the caller's role (admin /
// user / guest). Without Plex sign-in everyone is an admin.
const serviceAccess = createServiceAccess(store);
// Where services added in the UI are saved: config.json, or data/services.json
// when config.json is read-only (the Docker setup).
const serviceWriter = createServiceWriter();
const servicesFor = (req) => {
  const pc = publicConfig(cfg).services;
  for (const k of Object.keys(pc)) if (serviceWriter.sourceOf(k) === 'data') pc[k].savedHere = true;
  return serviceAccess.filterMap(seeing(req), pc);
};
// A subscriber's role, only when it's certain: listed by name or email, or
// (for the "any Plex user" default role) the subscription has the email too.
// Older subscriptions only stored the username; those are sent as before.
const subscriberRole = (u, e) => {
  const ids = [u, e].filter(Boolean).map((x) => String(x).toLowerCase().trim());
  const listed = plexAuth.roles.list().users.find((x) => ids.includes(x.id));
  if (listed) return listed.role;
  return e ? plexAuth.roles.lookup(u, e) : null;
};
const pushTo = pushFilter({ enabled: () => plexAuth.enabled, roleOf: subscriberRole, allowed: (r, k) => serviceAccess.allowed(r, k), known: (k) => !!cfg.services[k] });
const roleGuard = createRoleGuard(plexAuth, { canSee: (role, key) => serviceAccess.allowed(role, key), keyOf: (svc) => (svc && svc.key) || Object.keys(cfg.services).find((k) => cfg.services[k] === svc) });
const seeing = (req) => plexAuth.roleOf(req);
// Activity log hooks in before the role guard so refused attempts are logged too.
const activity = createActivityLog({ store, cfg, roleOf: (req) => plexAuth.roleOf(req) });
app.use(activity.middleware);
app.use(roleGuard.app);
// Your sign-in sessions and two-factor (any signed-in role, for themselves).
// Settings that follow you: per Plex user, or one shared profile with Basic auth.
const prefsWho = (req) => {
  if (plexAuth.enabled) return req.plexUser ? { key: `plex:${String(req.plexUser).toLowerCase()}`, label: req.plexUser } : null;
  return cfg.auth && cfg.auth.enabled ? { key: 'basic', label: 'the shared sign-in' } : null;
};
const userPrefs = createUserPrefs({ store, whoOf: prefsWho });
app.use('/api/account/prefs', userPrefs.router);
app.use('/api/account', plexAuth.account);
app.get('/api/activity', (req, res) => res.json(activity.list(req.query)));
app.delete('/api/activity', (req, res) => { activity.clear(); res.json({ ok: true }); });
app.use('/api/users', stepUp.app('changing roles'));
mountUserRoutes(app, plexAuth, { plex, cfg });
// Back up Arr Command Center itself (admin only; "Confirm it's you" with two-factor).
const APP_VERSION = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''); } catch { return ''; } })();
const selfBackup = createSelfBackup({
  cfg, store, serviceWriter, stepUp, plexAuth, appVersion: APP_VERSION,
  onServiceSaved: (key) => { statusCache.invalidate(key); uptime.forget(key); },
  after: (parts) => { if (parts.includes('notifications')) { push.reloadPush(); telegramBot.restart(); } },
});
app.use('/api/self-backup', selfBackup.router);
// Service-specific app routes follow the same per-role service list.
app.use((req, res, next) => {
  const role = seeing(req);
  if (role === 'admin' || !role) return next();
  const m = /^\/api\/(?:insights\/history|truenas|backups|indexer|media)\/([^/]+)/.exec(req.path);
  const key = m ? decodeURIComponent(m[1]) : (/^\/api\/plex\//.test(req.path) && !/^\/api\/plex\/image$/.test(req.path) ? Object.keys(cfg.services).find((k) => cfg.services[k].type === 'plex') : null);
  if (key && !serviceAccess.allowed(role, key)) return res.status(403).json({ error: 'Your role can’t use this service', role });
  next();
});
// Which services each role sees (admins only: /api/users is admin).
app.get('/api/users/services', (req, res) => {
  res.json({ settings: serviceAccess.read(), services: Object.entries(cfg.services).filter(([, s]) => s.enabled !== false).map(([k, s]) => ({ key: k, label: s.label || k, type: s.type })) });
});
app.put('/api/users/services', express.json({ limit: '8kb' }), (req, res) => {
  const r = serviceAccess.save(req.body || {}, Object.keys(cfg.services));
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ settings: r.settings });
});

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
app.get('/api/config', (req, res) => { const pc = publicConfig(cfg); res.json({ ...pc, services: servicesFor(req), ...(plexAuth.roleOf(req) === 'admin' && !cfg.mock ? { serviceStorage: serviceWriter.target() } : {}), buildId: BUILD_ID, auth: { plexEnabled: plexAuth.enabled, user: req.plexUser || null, role: plexAuth.roleOf(req), prefsSync: !!prefsWho(req) }, recap: !!tautulliFor() }); });

// Explicit credential-bearing export for the native local-fallback feature.
// Authentication middleware above protects this route; normal /api/config and
// diagnostics remain secret-free. POST + confirmation prevents prefetching or
// accidental navigation from returning service credentials.
app.post('/api/config/local-fallback', express.json({ limit: '1kb' }), (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  if (!req.body || req.body.confirm !== true) return res.status(400).json({ error: 'Explicit confirmation is required' });
  res.json(localFallbackConfig(cfg));
});

// Build identity for the frontend update banner. Never cached so a new deploy
// is seen promptly by polling clients.
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.json({ version: BUILD_ID, startedAt: START_TS });
});

// Aggregate connection status for all enabled services, served from a cache
// that pings every service in the background (see statusCache.js). ?fresh=1
// waits for a full re-check (manual refresh).
async function serviceHealth(key, svc) {
  if (svc.sample) return { label: svc.label || key, type: svc.type, ok: true, status: 200, ms: 0, version: 'sample' };
  if (svc.type === 'plex') { const ok = plex.hasToken(cfg); return { label: svc.label || key, type: 'plex', ok, status: ok ? 200 : 0, ms: 0, error: ok ? undefined : 'Sign in with Plex to enable' }; }
  const health = await pingService(svc, key).catch((e) => ({ ok: false, status: 0, ms: 0, error: (e && e.message) || 'ping failed' }));
  return { label: svc.label || key, type: svc.type, ...health };
}
// Service down/recovered alerts (after 2 min down) + 7-day uptime history.
const fmtDur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const uptime = createUptimeTracker({
  downAfterMs: Math.max(30000, Number(process.env.SERVICE_DOWN_AFTER_MS) || 120000),
  persist: !cfg.mock,
  onAlert: (a) => {
    if (process.env.NOTIFY_DISABLE) return;
    const msg = a.type === 'down'
      ? { title: `${a.label} is down`, body: a.error ? `Not responding: ${a.error}` : 'Not responding', url: '/', category: 'service' }
      : { title: `${a.label} is back up`, body: `Recovered after ${fmtDur(a.downFor)}`, url: '/', category: 'service' };
    channels.sendToChannels(msg, { globalEnabled: (c) => push.categoryEnabled(c) }).catch(() => {});
    if (push.categoryEnabled('service')) push.sendToAll(push.notification({ ...msg, tag: `service:${a.key}` }), { filter: pushTo([a.key]) }).catch(() => {});
  },
});
const statusCache = createStatusCache({
  entries: () => Object.entries(cfg.services).filter(([, s]) => s.enabled !== false),
  ping: serviceHealth,
  // Plex/sample entries aren't real pings; don't track them.
  onResult: (key, v) => { const svc = cfg.services[key]; if (svc && !svc.sample && svc.type !== 'plex') uptime.record(key, v); },
  intervalMs: Math.max(5000, Number(process.env.STATUS_POLL_MS) || 15000),
});
app.get('/api/uptime', (req, res) => {
  const days = Math.min(7, Math.max(1, Number(req.query.days) || 1));
  res.set('Cache-Control', 'no-store');
  res.json(serviceAccess.filterMap(seeing(req), uptime.all(days * 86400000, days === 1 ? 24 : 28)));
});
app.get('/api/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(serviceAccess.filterMap(seeing(req), await statusCache.get({ fresh: req.query.fresh === '1' })));
});

// Single-service status.
app.get('/api/status/:service', async (req, res) => {
  const svc = cfg.services[req.params.service];
  if (!svc || svc.enabled === false || !serviceAccess.allowed(seeing(req), req.params.service)) return res.status(404).json({ error: 'Unknown service' });
  if (svc.sample) return res.json({ label: svc.label || req.params.service, type: svc.type, ok: true, status: 200, ms: 0, version: 'sample' });
  if (svc.type === 'plex') { const ok = plex.hasToken(cfg); return res.json({ label: svc.label || req.params.service, type: 'plex', ok, status: ok ? 200 : 0, ms: 0, error: ok ? undefined : 'Sign in with Plex to enable' }); }
  res.json({ label: svc.label || req.params.service, type: svc.type, ...(await pingService(svc, req.params.service).catch((e) => ({ ok: false, status: 0, ms: 0, error: (e && e.message) || 'ping failed' }))) });
});

// Normalized cross-service action inbox and chronological activity feed.
app.get('/api/operations', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(250, Number(req.query.limit) || 100));
    const ops = await getOperations(cfg, { limit, ttlMs: req.query.fresh ? 0 : 5000 });
    const role = seeing(req);
    const keep = (x) => !x || !x.serviceKey || serviceAccess.allowed(role, x.serviceKey);
    res.json(role === 'admin' ? ops : Object.fromEntries(Object.entries(ops).map(([k, v]) => [k, Array.isArray(v) ? v.filter(keep) : v])));
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not collect operations data' });
  }
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

// Host system stats (CPU / memory / disks / network) for the optional Overview
// "system monitor" hexes. Disk paths come from config.system.disks or the
// SYSTEM_DISKS env (comma-separated); when unset, the server auto-discovers
// mounted disks. The UI chooses which of the reported disks to display.
function systemDiskPaths() {
  const fromCfg = cfg.system && Array.isArray(cfg.system.disks) ? cfg.system.disks : null;
  const fromEnv = process.env.SYSTEM_DISKS ? process.env.SYSTEM_DISKS.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const list = (fromCfg && fromCfg.length ? fromCfg : null) || (fromEnv && fromEnv.length ? fromEnv : null);
  return list && list.length ? list.map((p) => String(p)).slice(0, 24) : undefined;
}
app.get('/api/system', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getSystemStats({ disks: systemDiskPaths() }));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not read system stats' });
  }
});


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
    const result = push.addSubscription(sub, { user: req.plexUser || null, email: req.plexEmail || null, ua: req.headers['user-agent'] || '' });
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
    const ch = await channels.sendToChannels({ title: payload.title, body: payload.body, url: '', category: 'test' });
    res.json({ ok: true, ...result, channels: ch.sent, channelFailures: ch.failed });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Notification channels (ntfy/Gotify/Discord/Telegram/webhook) ----
// Secrets are masked in every response (see channels.js).
app.get('/api/notify/channels', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ channels: channels.listPublic(), types: channels.CHANNEL_TYPES, categories: push.CATEGORIES }); });
app.post('/api/notify/channels', express.json({ limit: '8kb' }), (req, res) => {
  const r = channels.upsertChannel(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true, channel: r.channel });
});
app.delete('/api/notify/channels/:id', (req, res) => res.json({ ok: true, ...channels.removeChannel(req.params.id) }));
app.post('/api/notify/channels/:id/test', async (req, res) => {
  const r = await channels.sendToChannels({ title: 'Arr Command Center', body: 'Test notification — this channel works 🎉', url: '', category: 'test' }, { only: req.params.id });
  if (!r.results.length) return res.status(404).json({ error: 'Unknown or disabled channel' });
  res.json(r.results[0]);
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
    const result = await pollOnce(cfg, { force, actionsFor });
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
// Wrong Plex matches: compare Plex's ids with the Sonarr/Radarr entry in the
// same folder. Admins can pick the right match from Plex's own search.
app.get('/api/plex/mismatches', async (req, res) => {
  try {
    const role = seeing(req);
    const arrs = Object.entries(cfg.services).filter(([k, s]) => (s.type === 'sonarr' || s.type === 'radarr') && s.enabled !== false && serviceAccess.allowed(role, k));
    const [plexItems, ...lists] = await Promise.all([plex.plexLibraryItems(cfg), ...arrs.map(([k, s]) => serviceGet(s, `api/v3/${s.type === 'sonarr' ? 'series' : 'movie'}`, { timeout: 30000 }).then((l) => (l || []).map((x) => ({ ...x, serviceKey: k, serviceLabel: s.label || k }))).catch(() => []))]);
    const r = plex.findWrongMatches(plexItems, lists.flat());
    res.json({ checked: plexItems.length, compared: r.compared, items: r.items });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Jellyfin / Emby: wrong matches (vs Sonarr/Radarr), Identify, and titles
// that keep transcoding (Playback Reporting plugin). :key is the server.
const mediaSvc = (req, res) => {
  const svc = cfg.services[req.params.key];
  if (!svc || svc.enabled === false || !['jellyfin', 'emby'].includes(svc.type)) { res.status(404).json({ error: 'Unknown media server' }); return null; }
  return svc;
};
const arrItemsFor = (req) => {
  const role = seeing(req);
  const arrs = Object.entries(cfg.services).filter(([k, s]) => (s.type === 'sonarr' || s.type === 'radarr') && s.enabled !== false && serviceAccess.allowed(role, k));
  return Promise.all(arrs.map(([k, s]) => serviceGet(s, `api/v3/${s.type === 'sonarr' ? 'series' : 'movie'}`, { timeout: 30000 })
    .then((l) => (l || []).map((x) => ({ ...x, serviceKey: k, serviceLabel: s.label || k }))).catch(() => []))).then((x) => x.flat());
};
app.get('/api/media/:key/mismatches', async (req, res) => {
  const svc = mediaSvc(req, res); if (!svc) return;
  res.set('Cache-Control', 'no-store');
  try { res.json(await mediaMismatches(svc, await arrItemsFor(req))); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/media/:key/matches/:id', async (req, res) => {
  const svc = mediaSvc(req, res); if (!svc) return;
  const q = req.query || {};
  try { res.json(await matchCandidates(svc, { kind: q.kind === 'show' ? 'show' : 'movie', title: q.title, year: q.year, idType: q.idType, id: q.id })); }
  catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message }); }
});
app.post('/api/media/:key/match/:id', express.json({ limit: '8kb' }), async (req, res) => {
  const svc = mediaSvc(req, res); if (!svc) return;
  try { await applyMatch(svc, req.params.id, (req.body || {}).result); res.json({ ok: true }); }
  catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message }); }
});
app.get('/api/media/:key/transcodes', async (req, res) => {
  const svc = mediaSvc(req, res); if (!svc) return;
  res.set('Cache-Control', 'no-store');
  try { res.json(await loadMediaTranscodes(svc, { days: req.query.days })); }
  catch (e) { res.status(e.status === 404 ? 404 : 502).json({ error: e.message }); }
});

// Plex server: libraries with scan / refresh details / empty trash, and who
// the server is shared with (plex.tv; admins only, see roles.js).
const plexErr = (res, e) => res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
app.get('/api/plex/server', async (req, res) => { res.set('Cache-Control', 'no-store'); try { res.json(await plex.plexServerInfo(cfg)); } catch (e) { plexErr(res, e); } });
app.post('/api/plex/library/:key/:action', async (req, res) => { try { await plex.plexLibraryAction(cfg, req.params.key, req.params.action); res.json({ ok: true }); } catch (e) { plexErr(res, e); } });
app.get('/api/plex/shares', async (req, res) => { res.set('Cache-Control', 'no-store'); try { res.json(await plex.plexShares(cfg)); } catch (e) { plexErr(res, e); } });
app.post('/api/plex/shares', express.json({ limit: '4kb' }), async (req, res) => { try { await plex.plexShareInvite(cfg, req.body || {}); res.json({ ok: true }); } catch (e) { plexErr(res, e); } });
app.put('/api/plex/shares/:id', express.json({ limit: '4kb' }), async (req, res) => { try { await plex.plexShareUpdate(cfg, req.params.id, (req.body || {}).libraries); res.json({ ok: true }); } catch (e) { plexErr(res, e); } });
app.delete('/api/plex/shares/:id', async (req, res) => { try { await plex.plexShareRemove(cfg, req.params.id); res.json({ ok: true }); } catch (e) { plexErr(res, e); } });

// Imported in Sonarr/Radarr but not showing in Plex (or with fewer episodes).
app.get('/api/plex/missing', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const role = seeing(req);
    const arrs = Object.entries(cfg.services).filter(([k, s]) => (s.type === 'sonarr' || s.type === 'radarr') && s.enabled !== false && serviceAccess.allowed(role, k));
    const [plexItems, sections, ...lists] = await Promise.all([plex.plexLibraryItems(cfg), plex.plexSections(cfg),
      ...arrs.map(([k, s]) => serviceGet(s, `api/v3/${s.type === 'sonarr' ? 'series' : 'movie'}`, { timeout: 30000 })
        .then((list) => (list || []).map((x) => ({
          kind: s.type === 'sonarr' ? 'show' : 'movie', serviceKey: k, serviceLabel: s.label || k, id: x.id, title: x.title, year: x.year, path: x.path, rootFolderPath: x.rootFolderPath,
          tmdbId: x.tmdbId, tvdbId: x.tvdbId,
          files: s.type === 'sonarr' ? Number((x.statistics || {}).episodeFileCount) || 0 : (x.hasFile ? 1 : 0),
          added: s.type === 'radarr' ? ((x.movieFile && x.movieFile.dateAdded) || null) : null,
        })))
        .catch(() => []))]);
    const r = plex.findMissingInPlex(plexItems, lists.flat(), sections);
    res.json({ checked: plexItems.length, ...r, sections: sections.filter((x) => x.type === 'movie' || x.type === 'show').map(({ key, type, title }) => ({ key, type, title })) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Scan one folder of a Plex library, or the whole library (no path).
app.post('/api/plex/scan', express.json({ limit: '4kb' }), async (req, res) => {
  const b = req.body || {};
  try { await plex.plexScan(cfg, String(b.section || ''), b.path == null || b.path === '' ? null : b.path); res.json({ ok: true }); }
  catch (e) { res.status(/^Bad /.test(e.message) ? 400 : 502).json({ error: e.message }); }
});
app.get('/api/plex/matches/:ratingKey', async (req, res) => {
  try { res.json(await plex.plexMatchCandidates(cfg, req.params.ratingKey, { title: req.query.title, year: req.query.year })); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/plex/match/:ratingKey', express.json({ limit: '2kb' }), async (req, res) => {
  try { await plex.plexApplyMatch(cfg, req.params.ratingKey, req.body || {}); res.json({ ok: true }); } catch (e) { res.status(502).json({ error: e.message }); }
});
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
    // redirect: 'manual' — a redirect from an allowed host must not carry the
    // Plex token to wherever it points.
    const r = await fetch(target, { headers: { 'X-Plex-Token': token }, signal: controller.signal, redirect: 'manual' });
    clearTimeout(timer);
    if (!r.ok) return res.status(r.status).end();
    const ct = r.headers.get('content-type'); if (ct) res.set('content-type', ct);
    res.set('Cache-Control', 'private, max-age=3600');
    // Stream the image body rather than buffering the whole thing in memory.
    // The Plex token is only ever sent upstream, never echoed to the browser.
    if (!r.body) { res.end(); return; }
    const onClose = () => { try { controller.abort(); } catch { /* ignore */ } };
    res.on('close', onClose);
    try {
      await pipeline(Readable.fromWeb(r.body), res);
    } catch (err) {
      try { controller.abort(); } catch { /* ignore */ }
      if (!res.writableEnded) res.destroy(err);
    } finally {
      res.off('close', onClose);
    }
  } catch { if (!res.headersSent) res.status(502).end(); else if (!res.writableEnded) res.end(); }
});

// The proxy (handles its own raw body parsing).
app.use('/api/proxy', createProxyRouter(cfg, { authorize: (req, svc, subPath) => roleGuard.proxy(req, svc, subPath) || stepUp.proxy(req, svc, subPath) }));

// Live updates (Server-Sent Events) for download queues and now-playing.
const liveHub = createLiveHub({ getService: (key) => cfg.services[key], fetchJson: (svc, p) => serviceGet(svc, p, { timeout: 8000 }), fetchClient: (svc, key) => liveClientFetch(svc, key) });
app.get('/api/live', liveHub.multiHandler(roleGuard.read));

// TRaSH Guides (public data, cached a day). Demo mode uses a bundled sample.
const trash = cfg.mock ? demoTrashSource() : createTrashSource();
app.get('/api/trash/:app/profiles', async (req, res) => {
  try { res.json((await trash.profiles(req.params.app)).map(({ profile, ...p }) => p)); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});
app.get('/api/trash/:app/profile/:slug', async (req, res) => {
  try { res.json(await trash.profileWithFormats(req.params.app, req.params.slug)); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

// Library growth: one size snapshot per Sonarr/Radarr/Lidarr instance per day.
const insights = createInsightsRecorder({ cfg, store });
const diskRecorder = createDiskRecorder({ cfg, store });
// Compatibility check: each service's version and the APIs the tools use
// (admins; read-only GETs).
app.get('/api/compat', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await runCompat(cfg, { canSee: (k) => serviceAccess.allowed(seeing(req), k) })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Setup doctor: read-only checks across the apps and download clients
// (admins: it reads download-client settings, though it never returns keys).
app.get('/api/doctor', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await runDoctor(cfg, { canSee: (k) => serviceAccess.allowed(seeing(req), k) })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Free-up-space planner: ranked titles that could go (all disks, or one disk
// from the forecast). Read-only; the browser deletes through the apps.
// Year in review (Tautulli). Everyone gets their own year; admins can pick
// anyone, or everyone together.
const yearReview = createYearReview();
const tautulliFor = () => Object.entries(cfg.services).find(([, s]) => s.type === 'tautulli' && s.enabled !== false) || null;
app.get('/api/recap', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const tau = tautulliFor();
  if (!tau) return res.status(404).json({ error: 'Year in review needs Tautulli, which keeps the watch history. Add it in Settings → Services.' });
  const thisYear = new Date().getFullYear();
  const year = Number(req.query.year) || thisYear;
  if (!Number.isInteger(year) || year < 2008 || year > thisYear) return res.status(400).json({ error: 'Pick a year from 2008 to this year.' });
  const admin = plexAuth.roleOf(req) === 'admin';
  try {
    const out = await yearReview.recap({ svcKey: tau[0], svc: tau[1], year, tz: String(req.query.tz || ''), viewer: plexAuth.enabled ? { user: req.plexUser, email: req.plexEmail } : null, admin, pick: req.query.user ? String(req.query.user) : null });
    res.json({ ...out, source: tau[1].label || 'Tautulli' });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.status ? e.message : `Couldn’t read Tautulli: ${e.message}` });
  }
});

app.get('/api/space/plan', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const role = seeing(req);
  const canSee = (k) => serviceAccess.allowed(role, k);
  let scope = null;
  if (req.query.disk) {
    scope = forecastDisks(store.get(DISK_NS, {}), store.get('librarySnapshots', {}), cfg, { visible: canSee }).find((d) => d.key === String(req.query.disk));
    if (!scope) return res.status(404).json({ error: 'That disk isn’t in the forecast any more. Pick another, or All disks.' });
  }
  const plexKey = Object.keys(cfg.services).find((k) => cfg.services[k].type === 'plex');
  try {
    const plan = await loadSpacePlan(cfg, { canSee, scope, plexItems: async () => (plex.hasToken(cfg) && plex.plexServerUrl(cfg) && (!plexKey || canSee(plexKey)) ? plex.plexLibraryItems(cfg) : null) });
    res.json({ ...plan, scope: scope ? { key: scope.key, label: scope.label, free: scope.free, total: scope.total, rate: scope.rate, days: scope.days, services: scope.services } : null });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Disk-full forecast for the disks that hold the apps' root folders.
app.get('/api/disks/forecast', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const role = seeing(req);
  res.json({ disks: forecastDisks(store.get(DISK_NS, {}), store.get('librarySnapshots', {}), cfg, { visible: (k) => serviceAccess.allowed(role, k) }) });
});
app.get('/api/insights/history/:key', (req, res) => {
  if (!cfg.services[req.params.key]) return res.status(404).json({ error: 'Unknown service' });
  res.json(insights.history(req.params.key));
});

// Backups are downloaded in the app itself: Sonarr/Radarr only serve the zip
// to their own web login, not to the API key. This sends an admin to the
// app's System → Backup page (browser URL if set, else the server's URL).
const BACKUP_TYPES = new Set(['sonarr', 'radarr', 'lidarr', 'readarr', 'bindery', 'prowlarr', 'whisparr', 'listenarr']);
app.get('/api/backups/:key/open', (req, res) => {
  const svc = cfg.services[req.params.key];
  if (!svc || !BACKUP_TYPES.has(svc.type)) return res.status(404).json({ error: 'Unknown service' });
  const base = String(svc.webUrl || svc.baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return res.status(404).json({ error: 'No address set for this service' });
  res.set('Cache-Control', 'no-store');
  res.redirect(302, `${base}/system/backup`);
});

// Weekly "recently added" digest (admins configure; off by default).
async function sendDigestMessage(msg) {
  const out = { channels: null, push: null };
  try { out.channels = await channels.sendToChannels(msg, { globalEnabled: (c) => push.categoryEnabled(c) }); } catch (e) { out.channels = { error: e.message }; }
  if (push.categoryEnabled('digest')) {
    // The digest covers every Sonarr and Radarr, so it goes to people who can see them all.
    const digestKeys = Object.entries(cfg.services).filter(([, s]) => (s.type === 'sonarr' || s.type === 'radarr') && s.enabled !== false).map(([k]) => k);
    try { out.push = await push.sendToAll(push.notification({ title: msg.title, body: msg.body.split('\n').slice(0, 6).join('\n'), url: msg.url, tag: 'digest' }), { filter: pushTo(digestKeys) }); } catch (e) { out.push = { error: e.message }; }
  }
  return out;
}
const digest = createDigest({ cfg, store, send: sendDigestMessage, logLine: (e) => console.log(JSON.stringify({ level: e.ok ? 'info' : 'warn', src: 'digest', ...e })) });
app.get('/api/bot', async (req, res) => {
  const svc = bot.seerrSvc();
  const seerrUsers = svc ? await serviceGet(svc, 'api/v1/user?take=100').then((d) => ((d && d.results) || []).map((u) => ({ id: u.id, name: u.displayName || u.plexUsername || u.email }))).catch(() => []) : [];
  const seerrs = Object.entries(cfg.services).filter(([, v]) => v.type === 'overseerr').map(([k, v]) => ({ key: k, label: v.label || k }));
  res.json({ ...publicBot(bot.settings(), { telegram: telegramBot.status() }), seerrUsers, seerrs, interactionsPath: '/api/bot/discord/interactions' });
});
app.put('/api/bot', express.json({ limit: '4kb' }), (req, res) => {
  const r = applyBotSettings(bot.settings(), req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  bot.save(r.settings);
  if (req.body && req.body.telegram) telegramBot.restart();
  res.json(publicBot(r.settings, { telegram: telegramBot.status() }));
});
app.put('/api/bot/users', express.json({ limit: '2kb' }), (req, res) => {
  const r = upsertBotUser(bot.settings(), req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  bot.save(r.settings); res.json({ ok: true });
});
app.delete('/api/bot/users/:platform/:id', (req, res) => {
  const s = bot.settings();
  const match = (x) => x.platform === req.params.platform && String(x.id) === req.params.id;
  bot.save({ ...s, users: s.users.filter((x) => !match(x)), pending: s.pending.filter((x) => !match(x)) });
  res.json({ ok: true });
});
app.post('/api/bot/discord/register', async (req, res) => {
  try { res.json({ ok: true, commands: await discordBot.registerCommands() }); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/webhooks', (req, res) => res.json({ hooks: webhooks.list() }));
app.post('/api/webhooks/:key/rotate', (req, res) => {
  if (!webhooks.list().some((h) => h.key === req.params.key)) return res.status(404).json({ error: 'Unknown service' });
  webhooks.rotate(req.params.key); res.json({ hooks: webhooks.list() });
});
// Add the webhook to a Sonarr/Radarr/… instance (Settings → Connect).
app.post('/api/webhooks/:key/install', express.json({ limit: '2kb' }), async (req, res) => {
  const svc = cfg.services[req.params.key];
  const hook = webhooks.list().find((h) => h.key === req.params.key);
  if (!svc || !hook) return res.status(404).json({ error: 'Unknown service' });
  const base = String((req.body && req.body.baseUrl) || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/.test(base)) return res.status(400).json({ error: 'Enter the address this app can reach Arr Command Center at, e.g. http://192.168.1.10:7373' });
  const v = ['sonarr', 'radarr', 'whisparr'].includes(svc.type) ? 'v3' : 'v1';
  const url = `${base}${hook.path}`;
  if (svc.type === 'qbittorrent') {
    try {
      const plan = qbitPrefsPlan(await qbitApi(svc, req.params.key, 'app/preferences'), url);
      if (!Object.keys(plan.set).length) return res.status(409).json({ error: 'qBittorrent already runs another program when a torrent finishes. Add the command below to that program yourself.', busy: plan.busy, command: qbitCommand(url, 'finished') });
      await qbitApi(svc, req.params.key, 'app/setPreferences', { form: { json: JSON.stringify(plan.set) } });
      return res.json({ ok: true, events: Object.keys(plan.set).filter((k) => k.endsWith('_program')).map((k) => (k === 'autorun_program' ? 'finished' : 'added')), busy: plan.busy });
    } catch (e) { return res.status(502).json({ error: e.message }); }
  }
  if (!['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'prowlarr'].includes(svc.type)) return res.status(400).json({ error: 'Add this one in the app itself (see the steps)' });
  try {
    const existing = await serviceGet(svc, `api/${v}/notification`);
    const mine = (existing || []).find((n) => n.implementation === 'Webhook' && ((n.fields || []).find((f) => f.name === 'url') || {}).value === url);
    if (mine) return res.json({ ok: true, already: true });
    const old = (existing || []).find((n) => n.implementation === 'Webhook' && /\/api\/hooks\//.test(String(((n.fields || []).find((f) => f.name === 'url') || {}).value || '')));
    const body = arrWebhookNotification(await serviceGet(svc, `api/${v}/notification/schema`), url);
    if (old) await serviceRequest(svc, `api/${v}/notification/${old.id}`, { method: 'PUT', body: { ...body, id: old.id } });
    else await serviceRequest(svc, `api/${v}/notification`, { method: 'POST', body });
    res.json({ ok: true, updated: !!old });
  } catch (e) {
    const msg = e.body && (Array.isArray(e.body) ? e.body.map((x) => x.errorMessage).join('; ') : e.body.message);
    res.status(502).json({ error: msg || e.message });
  }
});

app.get('/api/digest', async (req, res) => {
  const s = digest.settings();
  let preview = null;
  if (req.query.preview) { try { preview = await digest.build(); } catch (e) { preview = { error: e.message }; } }
  res.json({ settings: s, schedule: describeSchedule(s), preview });
});
app.put('/api/digest', express.json({ limit: '2kb' }), (req, res) => {
  const r = digest.save(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ settings: r.settings, schedule: describeSchedule(r.settings) });
});
app.post('/api/digest/send', async (req, res) => {
  try { res.json(await digest.sendNow()); } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

// TrueNAS: WebSocket JSON-RPC, so the server makes the calls and returns one
// read-only overview (pools, disks, apps, alerts). Reading is allowed for
// every role, like any other dashboard read.
app.get('/api/truenas/:service', async (req, res) => {
  const svc = cfg.services[req.params.service];
  if (!svc || svc.enabled === false || svc.type !== 'truenas') return res.status(404).json({ error: 'Unknown TrueNAS service' });
  res.set('Cache-Control', 'no-store');
  try { res.json(await truenasOverview(svc, { allowInsecure: !!(cfg.mock && svc.demoAllowInsecure) })); }
  catch (e) { res.status(e.status === 401 ? 401 : 502).json({ error: e.message }); }
});
app.get('/api/live/:service', liveHub.handler(roleGuard.read));

// ---- Add / edit / remove a service (writes config.json). Behind auth. ----
// Note: this persists API keys / Cloudflare tokens to config.json on the server.
app.post('/api/config/service', express.json({ limit: '32kb' }), async (req, res) => {
  if (cfg.mock) return res.status(400).json({ error: 'Services cannot be edited in demo mode' });
  const { key, service } = req.body || {};
  if (!key || !/^[a-z0-9_-]{1,40}$/i.test(key)) return res.status(400).json({ error: 'Invalid service key (use letters, numbers, - or _)' });
  if (!service || typeof service !== 'object') return res.status(400).json({ error: 'Missing service' });
  if (!ALLOWED_SERVICE_TYPES.includes(service.type)) return res.status(400).json({ error: `Type must be one of: ${ALLOWED_SERVICE_TYPES.join(', ')}` });
  // Build a clean service object (drops unknown fields). Blank secret fields keep
  // the existing values so editing label/type/path doesn't wipe the API key —
  // BUT only while the upstream origin is unchanged. If the origin changes,
  // secrets are not silently carried to the new host and must be re-supplied.
  const prev = cfg.services[key] || {};
  const built = buildServiceUpdate(key, service, prev, { isHttpUrl });
  if (built.error) return res.status(400).json({ error: built.error });
  const clean = built.clean;
  try {
    // Durable write first (config.json, or data/services.json when
    // config.json is read-only); only reflect into the live config once saved.
    const where = await serviceWriter.save(key, clean);
    cfg.services[key] = { ...clean }; // apply live (proxy/status read cfg.services per request)
    statusCache.invalidate(key);
    uptime.forget(key);
    res.json({ ok: true, savedIn: where, services: servicesFor(req) });
  } catch (err) {
    res.status(500).json({ error: `Could not save the service: ${err.message}` });
  }
});

// ---- Send an indexer or Prowlarr result to SABnzbd or an *arr.
// The browser only has links with the source's key redacted; the server puts
// it back (the source's own host only) and redacts replies again.
app.post('/api/indexer/:key/send', express.json({ limit: '16kb' }), createIndexerSend({ getService: (k) => cfg.services[k], canUse: (req, k) => serviceAccess.allowed(seeing(req), k), serviceGet, serviceRequest }));

// ---- Setup wizard: find apps on the network, then check a key before saving.
// The demo only looks at its own mock apps, never the real default ports.
let mockPorts = null;
app.get('/api/setup/networks', (req, res) => res.json({ subnets: cfg.mock ? [] : localSubnets(), demo: !!cfg.mock, canSave: !cfg.mock && !!serviceWriter.target() }));
app.post('/api/setup/discover', express.json({ limit: '4kb' }), async (req, res) => {
  const body = req.body || {};
  let ports = DEFAULT_PORTS;
  if (cfg.mock) {
    if (!mockPorts) { const { MOCK_PORTS } = await import('./mock/mockServices.js'); mockPorts = Object.fromEntries(Object.keys(DEFAULT_PORTS).filter((t) => MOCK_PORTS[t]).map((t) => [t, [MOCK_PORTS[t]]])); }
    ports = mockPorts;
  }
  try {
    const out = await discover({ hosts: cleanHosts(body.hosts), subnet: !cfg.mock && body.subnet === true, ports, mockOnly: !!cfg.mock, existing: cfg.services, timeoutMs: body.subnet ? 700 : 1500, concurrency: body.subnet ? 128 : 48 });
    res.json({ ...out, found: out.found.map((f) => ({ ...f, suggestedKey: f.existing || freeKey(f.type, Object.keys(cfg.services)) })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/setup/check', express.json({ limit: '8kb' }), async (req, res) => {
  const b = req.body || {};
  if (!ALLOWED_SERVICE_TYPES.includes(b.type)) return res.status(400).json({ error: 'Unknown service type' });
  if (!isHttpUrl(String(b.baseUrl || ''))) return res.status(400).json({ error: 'Enter an http:// or https:// address' });
  const svc = { type: b.type, baseUrl: String(b.baseUrl).replace(/\/+$/, ''), apiKey: String(b.apiKey || ''), username: b.username ? String(b.username) : undefined, password: b.password ? String(b.password) : undefined };
  if (svc.type === 'plex') return res.json(await checkPlex(svc));
  const r = await pingService(svc, `setup:${svc.type}:${svc.baseUrl}`).catch((e) => ({ ok: false, error: e.message }));
  res.json({ ok: !!r.ok, version: r.version || null, error: r.ok ? null : (r.error || `HTTP ${r.status}`) });
});

// Plex has no keyed health check: /identity is public, and a token is
// checked against the library list. With no token, the one captured at
// "Sign in with Plex" is used. Redirects are refused so the token stays put.
async function checkPlex(svc) {
  const get = (p, token) => fetch(`${svc.baseUrl}${p}`, { redirect: 'error', signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json', ...(token ? { 'X-Plex-Token': token } : {}) } });
  try {
    const id = await get('/identity');
    const mc = id.ok ? ((await id.json().catch(() => null)) || {}).MediaContainer : null;
    if (!mc || !mc.machineIdentifier) return { ok: false, version: null, error: 'That address doesn’t answer like a Plex server' };
    if (svc.apiKey) {
      const r = await get('/library/sections', svc.apiKey);
      if (r.status === 401 || r.status === 403) return { ok: false, version: null, error: 'Plex refused that token' };
      if (!r.ok) return { ok: false, version: null, error: `Plex answered HTTP ${r.status}` };
    } else if (!plexAuth.enabled) return { ok: false, version: null, error: 'Paste your Plex token, or turn on Sign in with Plex so the server can use yours' };
    return { ok: true, version: mc.version || null, error: null };
  } catch (e) { return { ok: false, version: null, error: e.name === 'TimeoutError' ? 'No answer from that address' : e.message }; }
}

app.delete('/api/config/service/:key', async (req, res) => {
  if (cfg.mock) return res.status(400).json({ error: 'Services cannot be edited in demo mode' });
  const key = req.params.key;
  if (!cfg.services[key]) return res.status(404).json({ error: 'Unknown service' });
  try {
    const where = await serviceWriter.remove(key);
    delete cfg.services[key];
    statusCache.invalidate(key);
    uptime.forget(key);
    res.json({ ok: true, savedIn: where, services: servicesFor(req) });
  } catch (err) {
    res.status(500).json({ error: `Could not save the change: ${err.message}` });
  }
});

// Static frontend. The app shell (index.html) is generated per request and
// never cached; it points at /b/<assetId>/... JS/CSS which are immutable (see
// assets.js), so relaunches load from the HTTP cache while a deploy can never
// mix old and new modules. Root-path JS/CSS (login page, the bundled native
// shell, old documents) stay uncached as before.
const assets = createAssetServer(PUBLIC_DIR);
const sendShell = (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.type('html').send(assets.shell());
};
app.get(['/', '/index.html'], sendShell);
app.use(assets.middleware);
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (/\.(html|css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
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
app.get('/{*path}', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  sendShell(req, res);
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
statusCache.start();
let poller = null;
if (!process.env.NOTIFY_DISABLE) {
  poller = startPoller(cfg, { intervalSeconds: Number(process.env.NOTIFY_POLL_SECONDS) || 60, actionsFor, pushFilter: pushTo });
}

// Automation scheduler (Queue Cleaner + Hunting). Ticks every minute; each job
// only runs when enabled and its configured interval has elapsed. Disable with
// AUTOMATION_DISABLE=1.
let automationTimer = null;
const insightsFirst = setTimeout(() => Promise.all([insights.tick(), diskRecorder.tick()]).then(() => { if (cfg.mock) { seedDemoHistory(store); seedDemoDiskHistory(store); } }).catch(() => {}), cfg.mock ? 3000 : 60000);
const insightsTimer = setInterval(() => { insights.tick().catch(() => {}); diskRecorder.tick().catch(() => {}); }, 3600000);
telegramBot.start();
const digestTimer = setInterval(() => digest.tick().catch(() => {}), 5 * 60000);
if (digestTimer.unref) digestTimer.unref();
if (insightsFirst.unref) insightsFirst.unref();
if (insightsTimer.unref) insightsTimer.unref();
if (!process.env.AUTOMATION_DISABLE) {
  automationTimer = setInterval(() => { automation.tick(cfg).catch(() => {}); }, 60000);
  if (automationTimer.unref) automationTimer.unref();
}

function shutdown() {
  console.log('\n[shutdown] closing servers...');
  if (poller) poller.stop();
  if (automationTimer) clearInterval(automationTimer);
  clearInterval(insightsTimer); clearTimeout(insightsFirst); clearInterval(digestTimer); telegramBot.stop();
  statusCache.stop();
  uptime.flush();
  server.close();
  for (const s of mockServers) s.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Safety net: never let a stray async rejection take down the whole server.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', (reason && reason.message) || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', (err && err.stack) || err);
});
