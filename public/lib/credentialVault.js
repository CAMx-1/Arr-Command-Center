import { normalizeCustomHeaders } from './customHeaders.js';

const VAULT_KEY = 'arrcc_local_connection_secrets_v2';
const CONNECTIONS_KEY = 'acc:connections';
let values = {};
let hydrated = false;
let writeChain = Promise.resolve();
const storageFor = (storage) => storage || globalThis.localStorage;
const plugin = () => globalThis.window?.Capacitor?.Plugins?.SecureStorage || null;
export function secureCredentialStorageAvailable() { return !!plugin()?.internalSetItem; }
const secretFields = (value = {}) => {
  let customHeaders = {};
  try { customHeaders = normalizeCustomHeaders(value.customHeaders); } catch {}
  return {
    apiKey: String(value.apiKey || ''),
    username: String(value.username || ''),
    password: String(value.password || ''),
    cfClientId: String(value.cfClientId || ''),
    cfClientSecret: String(value.cfClientSecret || ''),
    customHeaders,
  };
};
const hasSecrets = (value) => !!(value.apiKey || value.username || value.password || value.cfClientId || value.cfClientSecret || Object.keys(value.customHeaders || {}).length);
function legacySource(storage) {
  try { const parsed = JSON.parse(storageFor(storage).getItem(CONNECTIONS_KEY) || 'null'); return parsed && parsed.version === 2 && parsed.connections ? parsed.connections : (parsed && typeof parsed === 'object' ? parsed : {}); }
  catch { return {}; }
}
function scrubbedEnvelope(source) {
  const connections = {};
  for (const [key, value = {}] of Object.entries(source || {})) connections[key] = { key, type: String(value.type || key), label: String(value.label || key).slice(0, 60), localUrl: String(value.localUrl || value.baseUrl || '').replace(/\/+$/, ''), remoteUrl: String(value.remoteUrl || '').replace(/\/+$/, ''), connectionPolicy: ['auto', 'local', 'remote'].includes(value.connectionPolicy) ? value.connectionPolicy : 'auto' };
  return { version: 2, connections };
}
async function readNative() {
  const secure = plugin();
  if (!secure?.internalGetItem) return null;
  const result = await secure.internalGetItem({ prefixedKey: VAULT_KEY, sync: false });
  if (!result?.data) return {};
  const parsed = JSON.parse(result.data);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}
async function persist() {
  const secure = plugin();
  if (!secure?.internalSetItem) return;
  const snapshot = JSON.stringify(values);
  const task = writeChain.then(() => secure.internalSetItem({ prefixedKey: VAULT_KEY, data: snapshot, sync: false, access: 1 }));
  writeChain = task.catch(() => {});
  return task;
}
export async function hydrateCredentialVault(storage) {
  if (hydrated) return values;
  const source = legacySource(storage); const legacy = {};
  for (const [key, value] of Object.entries(source)) { const secret = secretFields(value); if (hasSecrets(secret)) legacy[key] = secret; }
  if (!secureCredentialStorageAvailable()) { values = { ...legacy, ...values }; hydrated = true; return values; }
  try { values = { ...legacy, ...(await readNative() || {}) }; if (Object.keys(legacy).length) await persist(); }
  catch { values = { ...legacy, ...values }; }
  storageFor(storage).setItem(CONNECTIONS_KEY, JSON.stringify(scrubbedEnvelope(source)));
  hydrated = true; return values;
}
export function getCredential(key) { return values[key] ? JSON.parse(JSON.stringify(values[key])) : {}; }
export function credentialSnapshot() { return JSON.parse(JSON.stringify(values)); }
export function stageCredential(key, value) { const next = secretFields(value); if (hasSecrets(next)) values[key] = next; else delete values[key]; return getCredential(key); }
export async function setCredential(key, value) { stageCredential(key, value); try { await persist(); } catch {} return getCredential(key); }
export async function removeCredential(key) { delete values[key]; try { await persist(); } catch {} }
export async function replaceCredentials(next) { values = {}; for (const [key, value] of Object.entries(next || {})) stageCredential(key, value); try { await persist(); } catch {} return credentialSnapshot(); }
