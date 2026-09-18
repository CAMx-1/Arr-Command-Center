// Server-to-local fallback snapshot helpers. The credential-bearing server
// response is strictly validated before it can replace local direct-mode state.
// Only an explicit allowlist of UI preference keys is copied across origins.

export const FALLBACK_STORAGE_KEY = 'acc:local-fallback';
export const FALLBACK_META_KEY = 'acc:local-fallback-meta';
export const CONNECTIONS_KEY = 'acc:connections';
export const MODE_KEY = 'acc:app-mode';

const SUPPORTED_TYPES = new Set([
  'sonarr', 'radarr', 'lidarr', 'readarr', 'overseerr', 'prowlarr',
  'bazarr', 'sabnzbd', 'qbittorrent', 'tautulli', 'indexer',
]);
const SAFE_PREF_KEYS = new Set([
  'theme', 'accent', 'acc:density', 'view-mode', 'svc-hidden', 'svc-order',
  'bn:pinned', 'activity-sources', 'upcoming-view',
]);
const SAFE_PREF_PREFIXES = ['view-mode:', 'tabs-'];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_PREF_VALUE = 100_000;
const MAX_PREF_TOTAL = 500_000;

const storageFor = (storage) => storage || globalThis.localStorage;
const cleanString = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function safeHttpOriginUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.toString().replace(/\/+$/, '');
  } catch { return ''; }
}

function safeDashboardScope(user) {
  const value = user && (user.id || user.uuid || user.username || user.email || user.title || user.displayName);
  return String(value || 'local').replace(/[^a-z0-9@._-]/gi, '_').slice(0, 80);
}

export function normalizeLocalFallbackExport(payload) {
  if (!payload || payload.version !== 1 || !payload.services || typeof payload.services !== 'object' || Array.isArray(payload.services)) {
    throw new Error('The server returned an invalid local fallback snapshot');
  }
  const connections = {};
  for (const [key, raw] of Object.entries(payload.services)) {
    if (!/^[a-z0-9._-]{1,80}$/i.test(key) || FORBIDDEN_KEYS.has(key) || !raw || typeof raw !== 'object') {
      throw new Error('The server returned an invalid service entry');
    }
    if (!SUPPORTED_TYPES.has(raw.type)) throw new Error(`Unsupported local service type: ${raw.type || 'unknown'}`);
    const baseUrl = safeHttpOriginUrl(raw.baseUrl);
    const apiKey = cleanString(raw.apiKey, 1000);
    if (!baseUrl || !apiKey) throw new Error(`Local fallback service “${key}” is missing a valid URL or API key`);
    const cfClientId = cleanString(raw.cfClientId, 1000);
    const cfClientSecret = cleanString(raw.cfClientSecret, 1000);
    if (!!cfClientId !== !!cfClientSecret) throw new Error(`Local fallback service “${key}” has incomplete Cloudflare credentials`);
    connections[key] = {
      key,
      type: raw.type,
      label: cleanString(raw.label, 60) || key,
      baseUrl,
      apiKey,
      ...(cfClientId ? { cfClientId, cfClientSecret } : {}),
    };
  }
  const skipped = Array.isArray(payload.skipped) ? payload.skipped.slice(0, 100).map((item) => ({
    key: cleanString(item && item.key, 80),
    label: cleanString(item && item.label, 60),
    reason: cleanString(item && item.reason, 180),
  })).filter((item) => item.key && item.reason) : [];
  return { version: 1, generatedAt: cleanString(payload.generatedAt, 40), connections, skipped };
}

export function collectSafeUiPreferences(storage, { dashboardUser } = {}) {
  const target = storageFor(storage);
  const preferences = {};
  let total = 0;
  const add = (key, value) => {
    if (typeof value !== 'string' || !value || value.length > MAX_PREF_VALUE || total + value.length > MAX_PREF_TOTAL) return;
    preferences[key] = value;
    total += value.length;
  };
  for (const key of SAFE_PREF_KEYS) {
    try { add(key, target.getItem(key)); } catch { /* unavailable */ }
  }
  try {
    for (let i = 0; i < Number(target.length || 0); i += 1) {
      const key = target.key(i);
      if (typeof key === 'string' && SAFE_PREF_PREFIXES.some((prefix) => key.startsWith(prefix))) add(key, target.getItem(key));
    }
  } catch { /* unavailable */ }
  try {
    const dashboard = target.getItem(`acc:dashboards:${safeDashboardScope(dashboardUser)}`);
    add('acc:dashboards:local', dashboard);
  } catch { /* unavailable */ }
  return preferences;
}

export function createLocalFallbackSnapshot(serverPayload, storage, options = {}) {
  const normalized = normalizeLocalFallbackExport(serverPayload);
  const syncedAt = new Date(options.now === undefined ? Date.now() : options.now).toISOString();
  return {
    version: 1,
    syncedAt,
    sourceGeneratedAt: normalized.generatedAt,
    connections: normalized.connections,
    preferences: collectSafeUiPreferences(storage, { dashboardUser: options.dashboardUser }),
    skipped: normalized.skipped,
  };
}

export function normalizeLocalFallbackSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !snapshot.connections || typeof snapshot.connections !== 'object' || Array.isArray(snapshot.connections)) {
    throw new Error('Saved local fallback data is invalid');
  }
  const normalized = normalizeLocalFallbackExport({
    version: 1,
    generatedAt: snapshot.sourceGeneratedAt || snapshot.syncedAt,
    services: snapshot.connections,
    skipped: snapshot.skipped,
  });
  const preferences = {};
  let total = 0;
  for (const [key, value] of Object.entries(snapshot.preferences || {})) {
    const safe = SAFE_PREF_KEYS.has(key) || SAFE_PREF_PREFIXES.some((prefix) => key.startsWith(prefix)) || key === 'acc:dashboards:local';
    if (!safe || typeof value !== 'string' || value.length > MAX_PREF_VALUE || total + value.length > MAX_PREF_TOTAL) continue;
    preferences[key] = value;
    total += value.length;
  }
  return {
    version: 1,
    syncedAt: cleanString(snapshot.syncedAt, 40),
    sourceGeneratedAt: normalized.generatedAt,
    connections: normalized.connections,
    preferences,
    skipped: normalized.skipped,
  };
}

export function fallbackMetadata(snapshot) {
  const normalized = normalizeLocalFallbackSnapshot(snapshot);
  return {
    syncedAt: normalized.syncedAt,
    serviceCount: Object.keys(normalized.connections).length,
    skipped: normalized.skipped,
  };
}

export function applyLocalFallbackSnapshot(snapshot, storage) {
  const normalized = normalizeLocalFallbackSnapshot(snapshot);
  const target = storageFor(storage);
  target.setItem(CONNECTIONS_KEY, JSON.stringify(normalized.connections));
  for (const [key, value] of Object.entries(normalized.preferences)) target.setItem(key, value);
  const metadata = fallbackMetadata(normalized);
  target.setItem(FALLBACK_META_KEY, JSON.stringify(metadata));
  return metadata;
}

export function readLocalFallbackMetadata(storage) {
  try {
    const value = JSON.parse(storageFor(storage).getItem(FALLBACK_META_KEY) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}
