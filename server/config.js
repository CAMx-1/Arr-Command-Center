// Config loader: merges config.json with environment variable overrides.
// In MOCK mode it synthesizes a config that points at the bundled mock services.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MOCK_PORTS } from './mock/mockServices.js';
import { normalizeCustomHeaders, hasCustomHeaders } from '../public/lib/customHeaders.js';

const fsp = fs.promises;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Minimal .env parser so we don't need the dotenv dependency.
export function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const SERVICE_TYPES = ['sonarr', 'radarr', 'lidarr', 'readarr', 'bindery', 'overseerr', 'sabnzbd', 'tautulli', 'prowlarr', 'bazarr', 'qbittorrent', 'transmission', 'deluge', 'nzbget', 'jellyfin', 'emby', 'indexer', 'plex'];
export const ALLOWED_SERVICE_TYPES = SERVICE_TYPES;
export const CONFIG_PATH = path.join(ROOT, 'config.json');

// ---- Atomic, serialized config.json writes ----
// All mutations of config.json funnel through a single in-process promise chain
// (a lightweight mutex) so concurrent add/update/delete requests can't perform a
// lost-update read-modify-write race. Each write goes to a unique temp file in
// the SAME directory (so rename() is atomic on the same filesystem) and is then
// renamed over the real file. The temp file is cleaned up if anything fails, and
// the on-disk file is only replaced once the new contents are durably written.
let writeChain = Promise.resolve();

// Queue `task` on the serialization chain. The chain never stays rejected, so a
// failed write does not poison subsequent writes; callers still see their own
// task's rejection via the returned promise.
function serialize(task) {
  const run = writeChain.then(task, task);
  writeChain = run.then(() => {}, () => {});
  return run;
}

// Read config.json, apply `mutate(disk)` to it, and durably persist the result.
// `mutate` returns an optional value that is passed back to the caller.
async function atomicUpdateConfig(mutate) {
  return serialize(async () => {
    const disk = JSON.parse(await fsp.readFile(CONFIG_PATH, 'utf8'));
    disk.services = disk.services || {};
    const result = mutate(disk);
    const tmp = path.join(
      path.dirname(CONFIG_PATH),
      `.config.${process.pid}.${randomUUID()}.tmp`
    );
    try {
      await fsp.writeFile(tmp, JSON.stringify(disk, null, 2) + '\n');
      await fsp.rename(tmp, CONFIG_PATH);
    } catch (err) {
      // Best-effort cleanup so failed writes don't leave orphan temp files.
      try { await fsp.unlink(tmp); } catch { /* already gone */ }
      throw err;
    }
    return result;
  });
}

// Persist a single service into config.json (add or update) and return it.
export async function saveServiceToDisk(key, service) {
  await atomicUpdateConfig((disk) => { disk.services[key] = service; });
  return service;
}

// Remove a service from config.json.
export async function removeServiceFromDisk(key) {
  await atomicUpdateConfig((disk) => { if (disk.services) delete disk.services[key]; });
}

// ---- Credential-safe service edits (pure helpers, exported for testing) ----

function defaultIsHttpUrl(u) {
  try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; }
  catch { return false; }
}

// True when the effective upstream ORIGIN (scheme + hostname + port, with default
// ports normalized) differs between two base URLs. Path/query/trailing-slash
// differences are intentionally ignored: a label-only or path-only edit must NOT
// count as an origin change (and therefore must not trigger credential clearing).
// A missing previous origin (brand-new service) is never treated as a change.
export function upstreamOriginChanged(prevBaseUrl, nextBaseUrl) {
  if (!prevBaseUrl || !nextBaseUrl) return false;
  let a, b;
  try { a = new URL(prevBaseUrl); } catch { return false; }
  try { b = new URL(nextBaseUrl); } catch { return false; }
  // URL.origin already normalizes default ports (e.g. http://h:80 -> http://h).
  return a.origin !== b.origin;
}

// Build the clean, persistable service object from an incoming edit.
//
// Behavior:
//   • Unknown fields are dropped.
//   • When the upstream origin is UNCHANGED, blank secret fields keep their
//     previous values (so editing a label/type/path doesn't wipe the API key).
//   • When the upstream origin CHANGES, secrets are NOT silently carried forward
//     to the new host. Any secret that previously existed but is not explicitly
//     re-supplied causes a 400-style error (returned as { error }) BEFORE any
//     write. This prevents leaking credentials to a different (possibly
//     attacker-controlled) origin.
//
// Returns { clean } on success or { error } on validation failure. Never echoes
// secret VALUES back in error messages — only the names of the missing fields.
export function buildServiceUpdate(key, service, prev = {}, { isHttpUrl = defaultIsHttpUrl } = {}) {
  if (!service || typeof service !== 'object') return { error: 'Missing service' };
  if (!ALLOWED_SERVICE_TYPES.includes(service.type)) {
    return { error: `Type must be one of: ${ALLOWED_SERVICE_TYPES.join(', ')}` };
  }
  if (service.baseUrl && !isHttpUrl(service.baseUrl)) {
    return { error: 'baseUrl must be an http(s) URL' };
  }

  const clean = {
    label: String(service.label || key).slice(0, 60),
    type: service.type,
    enabled: service.enabled !== false,
  };

  const baseUrl = service.baseUrl ? String(service.baseUrl).slice(0, 300) : prev.baseUrl;
  const originChanged = upstreamOriginChanged(prev.baseUrl, baseUrl);

  const suppliedApiKey = !!service.apiKey;
  const suppliedUsername = !!service.username;
  const suppliedPassword = !!service.password;
  const suppliedCf = !!(service.cloudflareAccess &&
    (service.cloudflareAccess.clientId || service.cloudflareAccess.clientSecret));
  const suppliedCustomHeaders = Object.prototype.hasOwnProperty.call(service, 'customHeaders');
  const prevHasCf = !!(prev.cloudflareAccess &&
    (prev.cloudflareAccess.clientId || prev.cloudflareAccess.clientSecret));
  const prevHasCustomHeaders = hasCustomHeaders(prev.customHeaders);

  if (originChanged) {
    // Refuse to carry any previously-stored secret over to a new origin unless
    // it is explicitly re-supplied in this request.
    const missing = [];
    if (prev.apiKey && !suppliedApiKey) missing.push('apiKey');
    if (prev.username && !suppliedUsername) missing.push('username');
    if (prev.password && !suppliedPassword) missing.push('password');
    if (prevHasCf && !suppliedCf) missing.push('cloudflareAccess');
    if (prevHasCustomHeaders && !suppliedCustomHeaders) missing.push('customHeaders');
    if (missing.length) {
      return {
        error: `Upstream origin changed to ${new URL(baseUrl).origin}; ` +
          `re-enter credentials for the new host (${missing.join(', ')}). ` +
          `Existing secrets are not carried over to a different origin.`,
      };
    }
  }

  if (baseUrl) clean.baseUrl = baseUrl;

  // Secrets: use supplied value; otherwise keep previous ONLY if origin unchanged.
  const apiKey = suppliedApiKey
    ? String(service.apiKey).slice(0, 300)
    : (originChanged ? undefined : prev.apiKey);
  if (apiKey) clean.apiKey = apiKey;

  const username = suppliedUsername
    ? String(service.username).slice(0, 120)
    : (originChanged ? undefined : prev.username);
  const password = suppliedPassword
    ? String(service.password).slice(0, 300)
    : (originChanged ? undefined : prev.password);
  if (username) clean.username = username;
  if (password) clean.password = password;

  if (suppliedCf) {
    clean.cloudflareAccess = {
      clientId: String(service.cloudflareAccess.clientId || '').slice(0, 300),
      clientSecret: String(service.cloudflareAccess.clientSecret || '').slice(0, 300),
    };
  } else if (prevHasCf && !originChanged) {
    clean.cloudflareAccess = prev.cloudflareAccess;
  }

  try {
    if (suppliedCustomHeaders) clean.customHeaders = normalizeCustomHeaders(service.customHeaders);
    else if (prevHasCustomHeaders && !originChanged) clean.customHeaders = normalizeCustomHeaders(prev.customHeaders);
  } catch (error) { return { error: error.message }; }

  if (clean.type === 'deluge' && !clean.password) return { error: 'Deluge Web password is required' };
  if (clean.type === 'nzbget' && (!clean.username || !clean.password)) return { error: 'NZBGet ControlUsername and ControlPassword are required' };
  if (clean.type === 'transmission' && (!!clean.username !== !!clean.password)) return { error: 'Enter both Transmission username and password, or leave both blank' };

  return { clean };
}

function envKey(serviceKey, suffix) {
  return `${serviceKey.toUpperCase()}_${suffix}`;
}

// Apply per-service env overrides onto a service object.
function applyServiceEnv(key, svc) {
  const base = process.env[envKey(key, 'BASE_URL')];
  const apiKey = process.env[envKey(key, 'API_KEY')];
  const cfId = process.env[envKey(key, 'CF_CLIENT_ID')];
  const cfSecret = process.env[envKey(key, 'CF_CLIENT_SECRET')];
  const username = process.env[envKey(key, 'USERNAME')];
  const password = process.env[envKey(key, 'PASSWORD')];
  const customHeaders = process.env[envKey(key, 'CUSTOM_HEADERS')];
  if (base) svc.baseUrl = base;
  if (apiKey) svc.apiKey = apiKey;
  if (username) svc.username = username;
  if (password) svc.password = password;
  if (customHeaders) {
    try { svc.customHeaders = normalizeCustomHeaders(JSON.parse(customHeaders)); }
    catch (error) { console.warn(`[config] ignoring invalid ${envKey(key, 'CUSTOM_HEADERS')}: ${error.message}`); }
  }
  if (cfId || cfSecret) {
    svc.cloudflareAccess = svc.cloudflareAccess || {};
    if (cfId) svc.cloudflareAccess.clientId = cfId;
    if (cfSecret) svc.cloudflareAccess.clientSecret = cfSecret;
  }
  return svc;
}

function buildMockConfig() {
  const mk = (key, label, type, port) => ({
    label,
    type,
    enabled: true,
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: 'MOCK_API_KEY',
    cloudflareAccess: { clientId: 'mock.access', clientSecret: 'mock-secret' },
  });
  const mkLogin = (label, type, port, username, password) => ({
    label, type, enabled: true, baseUrl: `http://127.0.0.1:${port}`,
    ...(username ? { username } : {}), password,
    cloudflareAccess: { clientId: 'mock.access', clientSecret: 'mock-secret' },
  });
  return {
    port: Number(process.env.PORT) || 7373,
    host: process.env.HOST || '127.0.0.1',
    mock: true,
    auth: { enabled: false },
    services: {
      sonarr: mk('sonarr', 'Sonarr', 'sonarr', MOCK_PORTS.sonarr),
      'sonarr-anime': mk('sonarr-anime', 'Sonarr (Anime)', 'sonarr', MOCK_PORTS.sonarrAnime),
      radarr: mk('radarr', 'Radarr', 'radarr', MOCK_PORTS.radarr),
      'radarr-4k': mk('radarr-4k', 'Radarr (4K)', 'radarr', MOCK_PORTS.radarr4k),
      lidarr: mk('lidarr', 'Lidarr', 'lidarr', MOCK_PORTS.lidarr),
      readarr: mk('readarr', 'Readarr (Legacy)', 'readarr', MOCK_PORTS.readarr),
      bindery: mk('bindery', 'Bindery', 'bindery', MOCK_PORTS.bindery),
      overseerr: mk('overseerr', 'Overseerr', 'overseerr', MOCK_PORTS.overseerr),
      sabnzbd: mk('sabnzbd', 'SABnzbd', 'sabnzbd', MOCK_PORTS.sabnzbd),
      tautulli: mk('tautulli', 'Tautulli', 'tautulli', MOCK_PORTS.tautulli),
      bazarr: mk('bazarr', 'Bazarr', 'bazarr', MOCK_PORTS.bazarr),
      qbittorrent: mk('qbittorrent', 'qBittorrent', 'qbittorrent', MOCK_PORTS.qbittorrent),
      transmission: mkLogin('Transmission', 'transmission', MOCK_PORTS.transmission, 'admin', 'transmission'),
      deluge: mkLogin('Deluge', 'deluge', MOCK_PORTS.deluge, '', 'deluge'),
      nzbget: mkLogin('NZBGet', 'nzbget', MOCK_PORTS.nzbget, 'nzbget', 'nzbget'),
      jellyfin: mk('jellyfin', 'Jellyfin', 'jellyfin', MOCK_PORTS.jellyfin),
      emby: mk('emby', 'Emby', 'emby', MOCK_PORTS.emby),
      // Public Usenet indexer (e.g. NZBGeek) — Newznab-compatible API, no custom headers.
      indexer: { label: 'Indexer', type: 'indexer', enabled: true, baseUrl: `http://127.0.0.1:${MOCK_PORTS.indexer}`, apiKey: 'MOCK_API_KEY' },
    },
  };
}

export function loadConfig() {
  loadDotEnv();
  const isMock = process.env.MOCK === '1' || process.env.MOCK === 'true';
  if (isMock) return buildMockConfig();

  const configPath = path.join(ROOT, 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `No config.json found at ${configPath}.\n` +
      `Copy config.example.json to config.json and fill in your values, ` +
      `or run in demo mode with:  npm run demo`
    );
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse config.json: ${err.message}`);
  }

  cfg.port = Number(process.env.PORT) || cfg.port || 7373;
  cfg.host = process.env.HOST || cfg.host || '127.0.0.1';

  cfg.auth = cfg.auth || { enabled: false };
  if (process.env.AUTH_ENABLED !== undefined) cfg.auth.enabled = process.env.AUTH_ENABLED === 'true';
  if (process.env.AUTH_USERNAME) cfg.auth.username = process.env.AUTH_USERNAME;
  if (process.env.AUTH_PASSWORD) cfg.auth.password = process.env.AUTH_PASSWORD;

  cfg.services = cfg.services || {};
  for (const key of Object.keys(cfg.services)) {
    applyServiceEnv(key, cfg.services[key]);
  }

  // Validate service types
  for (const [key, svc] of Object.entries(cfg.services)) {
    if (!SERVICE_TYPES.includes(svc.type)) {
      console.warn(`[config] service "${key}" has unknown type "${svc.type}" — proxy auth injection may be incomplete.`);
    }
  }

  return cfg;
}

// True when the app would expose the secret-injecting proxy on a non-loopback
// interface with NO authentication and no explicit opt-in. Used to fail closed.
// Escape hatches (for instances already protected by an external layer such as
// Cloudflare Access / an authenticated tunnel): cfg.allowInsecure or
// ALLOW_INSECURE=true. Demo (mock) mode is always allowed.
export function isInsecureExposure(cfg, anyAuth) {
  const localOnly = cfg.host === '127.0.0.1' || cfg.host === 'localhost' || cfg.host === '::1';
  const allowInsecure = !!cfg.mock || !!cfg.allowInsecure || process.env.ALLOW_INSECURE === 'true';
  return !localOnly && !anyAuth && !allowInsecure;
}

export function serviceConfigured(svc = {}) {
  if (!svc.baseUrl) return false;
  if (svc.type === 'transmission') return true; // Basic auth is optional.
  if (svc.type === 'deluge') return !!svc.password;
  if (svc.type === 'nzbget') return !!(svc.username && svc.password);
  return !!svc.apiKey || !!(svc.username && svc.password);
}

// Public-safe view of the config for the frontend (no secrets).
export function publicConfig(cfg) {
  const services = {};
  for (const [key, svc] of Object.entries(cfg.services)) {
    if (svc.enabled === false) continue;
    services[key] = {
      key,
      label: svc.label || key,
      type: svc.type,
      hasCloudflareAccess: !!(svc.cloudflareAccess && svc.cloudflareAccess.clientId),
      hasCustomHeaders: hasCustomHeaders(svc.customHeaders),
      configured: serviceConfigured(svc),
      // A sample service renders built-in demo data client-side (no backend).
      sample: !!svc.sample,
      // When embed is enabled, expose the browser-reachable URL so the UI can
      // iframe the real app instead of using the custom panel. Only safe/useful
      // for services NOT behind Cloudflare Access (the browser can't inject the
      // service token), so we refuse to embed those.
      embed: !!svc.embed && !(svc.cloudflareAccess && svc.cloudflareAccess.clientId),
      embedUrl: (svc.embed && !(svc.cloudflareAccess && svc.cloudflareAccess.clientId)) ? svc.baseUrl : undefined,
    };
  }
  return { mock: !!cfg.mock, services };
}


// Credential-bearing export used only by the explicit native local-fallback
// sync endpoint. This is deliberately separate from publicConfig(), which must
// remain secret-free for every normal page/config request.
const LOCAL_FALLBACK_TYPES = new Set([
  'sonarr', 'radarr', 'lidarr', 'readarr', 'bindery', 'overseerr', 'prowlarr',
  'bazarr', 'sabnzbd', 'qbittorrent', 'transmission', 'deluge', 'nzbget', 'jellyfin', 'emby', 'tautulli', 'indexer',
]);

function fallbackHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.toString().replace(/\/+$/, '');
  } catch { return ''; }
}

export function localFallbackConfig(cfg, { now = Date.now() } = {}) {
  const services = {};
  const skipped = [];
  const entries = Object.entries((cfg && cfg.services) || {});

  for (const [key, svc = {}] of entries) {
    if (svc.enabled === false) continue;
    const reason = (message) => skipped.push({ key: String(key).slice(0, 80), label: String(svc.label || key).slice(0, 60), reason: message });
    if (!/^[a-z0-9._-]{1,80}$/i.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) { reason('Unsupported service key'); continue; }
    if (!LOCAL_FALLBACK_TYPES.has(svc.type)) { reason(svc.type === 'plex' ? 'Plex requires server-side OAuth' : 'Service type is not supported in local mode'); continue; }
    if (svc.sample) { reason('Sample services are not exported'); continue; }

    const baseUrl = fallbackHttpUrl(svc.baseUrl);
    if (!baseUrl) { reason('Missing or invalid service URL'); continue; }
    const apiKey = String(svc.apiKey || '').trim();
    const username = String(svc.username || '').trim();
    const password = String(svc.password || '').trim();
    if (svc.type === 'qbittorrent' && !apiKey) {
      reason((username || password)
        ? 'qBittorrent username/password login is not supported in local mode; configure an API key'
        : 'API key is required for local mode');
      continue;
    }
    if (svc.type === 'deluge' && !password) { reason('Deluge Web password is required for local mode'); continue; }
    if (svc.type === 'nzbget' && (!username || !password)) { reason('NZBGet username and password are required for local mode'); continue; }
    if (svc.type === 'transmission' && (!!username !== !!password)) { reason('Transmission Basic auth credentials are incomplete'); continue; }
    const loginType = ['transmission', 'deluge', 'nzbget'].includes(svc.type);
    if (!loginType && !apiKey) { reason('API key is required for local mode'); continue; }

    const cf = svc.cloudflareAccess || {};
    const cfClientId = String(cf.clientId || '').trim();
    const cfClientSecret = String(cf.clientSecret || '').trim();
    if (!!cfClientId !== !!cfClientSecret) { reason('Cloudflare Access credentials are incomplete'); continue; }

    services[key] = {
      key,
      type: svc.type,
      label: String(svc.label || key).slice(0, 60),
      baseUrl: baseUrl.slice(0, 500),
      ...(apiKey ? { apiKey: apiKey.slice(0, 1000) } : {}),
      ...(username ? { username: username.slice(0, 120) } : {}),
      ...(password ? { password: password.slice(0, 1000) } : {}),
      ...(cfClientId ? { cfClientId: cfClientId.slice(0, 1000), cfClientSecret: cfClientSecret.slice(0, 1000) } : {}),
      ...(hasCustomHeaders(svc.customHeaders) ? { customHeaders: normalizeCustomHeaders(svc.customHeaders) } : {}),
    };
  }

  return { version: 1, generatedAt: new Date(now).toISOString(), services, skipped };
}
