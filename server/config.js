// Config loader: merges config.json with environment variable overrides.
// In MOCK mode it synthesizes a config that points at the bundled mock services.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_PORTS } from './mock/mockServices.js';

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

const SERVICE_TYPES = ['sonarr', 'radarr', 'overseerr', 'sabnzbd', 'tautulli', 'prowlarr', 'bazarr', 'qbittorrent', 'plex'];
export const ALLOWED_SERVICE_TYPES = SERVICE_TYPES;
export const CONFIG_PATH = path.join(ROOT, 'config.json');

// Persist a single service into config.json (add or update) and return it.
export function saveServiceToDisk(key, service) {
  const disk = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  disk.services = disk.services || {};
  disk.services[key] = service;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(disk, null, 2) + '\n');
  return service;
}

// Remove a service from config.json.
export function removeServiceFromDisk(key) {
  const disk = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (disk.services) delete disk.services[key];
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(disk, null, 2) + '\n');
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
  if (base) svc.baseUrl = base;
  if (apiKey) svc.apiKey = apiKey;
  if (username) svc.username = username;
  if (password) svc.password = password;
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
      overseerr: mk('overseerr', 'Overseerr', 'overseerr', MOCK_PORTS.overseerr),
      sabnzbd: mk('sabnzbd', 'SABnzbd', 'sabnzbd', MOCK_PORTS.sabnzbd),
      tautulli: mk('tautulli', 'Tautulli', 'tautulli', MOCK_PORTS.tautulli),
      bazarr: mk('bazarr', 'Bazarr', 'bazarr', MOCK_PORTS.bazarr),
      qbittorrent: mk('qbittorrent', 'qBittorrent', 'qbittorrent', MOCK_PORTS.qbittorrent),
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
      configured: !!svc.baseUrl && (!!svc.apiKey || (!!svc.username && !!svc.password)),
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
