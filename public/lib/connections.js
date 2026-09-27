// Local direct-mode connection storage and request construction.
import { mergeProtectedHeaders, normalizeCustomHeaders } from './customHeaders.js';
import { getCredential, stageCredential, setCredential, removeCredential, replaceCredentials, secureCredentialStorageAvailable } from './credentialVault.js';

const MODE_KEY = 'acc:app-mode';
const CONN_KEY = 'acc:connections';
export const CONNECTIONS_VERSION = 2;
const storageFor = (s) => s || globalThis.localStorage;
const trimSlash = (u) => String(u || '').trim().replace(/\/+$/, '');

function basicCredentials(username, password) {
  const bytes = new TextEncoder().encode(`${username || ''}:${password || ''}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const LOCAL_SERVICE_DEFS = [
  { type: 'sonarr', name: 'Sonarr', urlPlaceholder: 'https://sonarr.example.com' },
  { type: 'radarr', name: 'Radarr', urlPlaceholder: 'https://radarr.example.com' },
  { type: 'lidarr', name: 'Lidarr', urlPlaceholder: 'https://lidarr.example.com' },
  { type: 'readarr', name: 'Readarr (Legacy)', urlPlaceholder: 'https://readarr.example.com' },
  { type: 'bindery', name: 'Bindery', urlPlaceholder: 'https://bindery.example.com' },
  { type: 'overseerr', name: 'Overseerr / Seerr', urlPlaceholder: 'https://requests.example.com' },
  { type: 'prowlarr', name: 'Prowlarr', urlPlaceholder: 'https://prowlarr.example.com' },
  { type: 'bazarr', name: 'Bazarr', urlPlaceholder: 'https://bazarr.example.com' },
  { type: 'sabnzbd', name: 'SABnzbd', urlPlaceholder: 'https://sabnzbd.example.com' },
  { type: 'qbittorrent', name: 'qBittorrent', urlPlaceholder: 'https://qbit.example.com', keyHint: 'WebUI API key (qBittorrent 5.2+)' },
  { type: 'transmission', name: 'Transmission', urlPlaceholder: 'http://transmission.local:9091', credentialMode: 'optional-basic' },
  { type: 'deluge', name: 'Deluge', urlPlaceholder: 'http://deluge.local:8112', credentialMode: 'password' },
  { type: 'nzbget', name: 'NZBGet', urlPlaceholder: 'http://nzbget.local:6789', credentialMode: 'basic' },
  { type: 'jellyfin', name: 'Jellyfin', urlPlaceholder: 'http://jellyfin.local:8096' },
  { type: 'emby', name: 'Emby', urlPlaceholder: 'http://emby.local:8096' },
  { type: 'tautulli', name: 'Tautulli', urlPlaceholder: 'https://tautulli.example.com' },
  { type: 'indexer', name: 'Indexer (Newznab)', urlPlaceholder: 'https://indexer.example.com' },
];
export const LOCAL_SUPPORTED = LOCAL_SERVICE_DEFS.map((d) => d.type);
export function localServiceDef(type) { return LOCAL_SERVICE_DEFS.find((d) => d.type === type) || null; }

export function getAppMode(storage) { try { return storageFor(storage).getItem(MODE_KEY) === 'local' ? 'local' : 'server'; } catch { return 'server'; } }
export function setAppMode(mode, storage) { const value = mode === 'local' ? 'local' : 'server'; try { storageFor(storage).setItem(MODE_KEY, value); } catch {} return value; }
export function isLocalMode(storage) { return getAppMode(storage) === 'local'; }

export function normalizeConnection(key, value = {}) {
  value = { ...value, ...getCredential(key) };
  const localUrl = trimSlash(value.localUrl || value.baseUrl);
  const remoteUrl = trimSlash(value.remoteUrl);
  const policy = ['auto', 'local', 'remote'].includes(value.connectionPolicy) ? value.connectionPolicy : 'auto';
  let customHeaders = {};
  try { customHeaders = normalizeCustomHeaders(value.customHeaders); } catch { customHeaders = {}; }
  return {
    key,
    type: String(value.type || key),
    label: String(value.label || key).slice(0, 60),
    localUrl,
    remoteUrl,
    connectionPolicy: policy,
    // baseUrl remains as a compatibility view for older UI/helpers.
    baseUrl: policy === 'remote' ? (remoteUrl || localUrl) : (localUrl || remoteUrl),
    apiKey: String(value.apiKey || ''),
    username: String(value.username || ''),
    password: String(value.password || ''),
    cfClientId: String(value.cfClientId || ''),
    cfClientSecret: String(value.cfClientSecret || ''),
    customHeaders,
  };
}
export function getConnections(storage) {
  try {
    const parsed = JSON.parse(storageFor(storage).getItem(CONN_KEY) || 'null');
    const source = parsed && parsed.version === CONNECTIONS_VERSION && parsed.connections ? parsed.connections : parsed;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, normalizeConnection(key, value)]));
  } catch { return {}; }
}
function metadataOnly(key, value) { const metadata = { key, type: value.type, label: value.label, localUrl: value.localUrl, remoteUrl: value.remoteUrl, connectionPolicy: value.connectionPolicy }; return secureCredentialStorageAvailable() ? metadata : { ...metadata, ...getCredential(key) }; }
function saveConnections(all, storage) { const metadata = Object.fromEntries(Object.entries(all).map(([key, value]) => [key, metadataOnly(key, value)])); try { storageFor(storage).setItem(CONN_KEY, JSON.stringify({ version: CONNECTIONS_VERSION, connections: metadata })); } catch {} return all; }
export function getConnection(key, storage) { return getConnections(storage)[key] || null; }
export function setConnection(key, conn, storage) { const all = getConnections(storage); stageCredential(key, conn); all[key] = normalizeConnection(key, { ...all[key], ...conn }); saveConnections(all, storage); setCredential(key, all[key]).catch(() => {}); return all[key]; }
export async function setConnectionSecure(key, conn, storage) { const all = getConnections(storage); await setCredential(key, conn); all[key] = normalizeConnection(key, { ...all[key], ...conn }); saveConnections(all, storage); return all[key]; }
export function replaceConnections(connections, storage) { const normalized = Object.fromEntries(Object.entries(connections || {}).map(([key, value]) => { stageCredential(key, value); return [key, normalizeConnection(key, value)]; })); saveConnections(normalized, storage); replaceCredentials(normalized).catch(() => {}); return normalized; }
export async function replaceConnectionsSecure(connections, storage) { await replaceCredentials(connections || {}); const normalized = Object.fromEntries(Object.entries(connections || {}).map(([key, value]) => [key, normalizeConnection(key, value)])); return saveConnections(normalized, storage); }
export function removeConnection(key, storage) { const all = getConnections(storage); delete all[key]; removeCredential(key).catch(() => {}); return saveConnections(all, storage); }

export function connectionCandidates(conn, preferredBaseUrl = '') {
  const local = trimSlash(conn && (conn.localUrl || conn.baseUrl));
  const remote = trimSlash(conn && conn.remoteUrl);
  const policy = conn && conn.connectionPolicy;
  let values = policy === 'remote' ? [remote || local] : policy === 'local' ? [local || remote] : [local, remote];
  values = [...new Set(values.filter(Boolean))];
  const preferred = trimSlash(preferredBaseUrl);
  if (policy === 'auto' && preferred && values.includes(preferred)) values = [preferred, ...values.filter((value) => value !== preferred)];
  return values;
}

export function authFor(conn, { baseUrl } = {}) {
  const generated = {};
  const query = {};
  const type = conn && conn.type;
  if (type === 'sabnzbd' || type === 'tautulli' || type === 'indexer') { if (conn.apiKey) query.apikey = conn.apiKey; }
  else if (type === 'bazarr') { if (conn.apiKey) generated['X-API-KEY'] = conn.apiKey; }
  else if (type === 'qbittorrent') {
    if (conn.apiKey) generated.Authorization = `Bearer ${conn.apiKey}`;
    const origin = trimSlash(baseUrl || conn.baseUrl || conn.localUrl || conn.remoteUrl);
    if (origin) { generated.Referer = origin; generated.Origin = origin; }
  } else if (type === 'transmission' || type === 'nzbget') {
    if (conn.username || conn.password) generated.Authorization = `Basic ${basicCredentials(conn.username, conn.password)}`;
  } else if (type === 'deluge') {
    // auth.login + _session_id are handled by localBackend's direct transport.
  } else if (type === 'jellyfin' || type === 'emby') {
    if (conn.apiKey) generated['X-Emby-Token'] = conn.apiKey;
  } else if (conn && conn.apiKey) generated['X-Api-Key'] = conn.apiKey;
  const cf = {};
  if (conn && conn.cfClientId && conn.cfClientSecret) { cf['CF-Access-Client-Id'] = conn.cfClientId; cf['CF-Access-Client-Secret'] = conn.cfClientSecret; }
  return { headers: mergeProtectedHeaders(conn && conn.customHeaders, generated, cf), query };
}

function requestForBase(proxyPath, conn, baseUrl) {
  const parts = String(proxyPath).split(/\?(.*)/s);
  const pathOnly = parts[0]; const rawQs = parts[1] || '';
  const match = pathOnly.match(/^\/api\/proxy\/[^/]+\/(.*)$/);
  const upstream = match ? match[1] : pathOnly.replace(/^\/+/, '');
  const { headers, query } = authFor(conn, { baseUrl });
  const existing = new URLSearchParams(rawQs); const authPairs = [];
  for (const [key, value] of Object.entries(query)) if (!existing.has(key)) authPairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  const qs = authPairs.length ? (rawQs ? `${rawQs}&${authPairs.join('&')}` : authPairs.join('&')) : rawQs;
  return { url: `${trimSlash(baseUrl)}/${upstream}${qs ? `?${qs}` : ''}`, headers, baseUrl: trimSlash(baseUrl) };
}
export function buildDirectRequestCandidates(proxyPath, conn, options = {}) { return connectionCandidates(conn, options.preferredBaseUrl).map((baseUrl) => requestForBase(proxyPath, conn, baseUrl)); }
export function buildDirectRequest(proxyPath, conn) { return buildDirectRequestCandidates(proxyPath, conn)[0] || { url: '', headers: {}, baseUrl: '' }; }
