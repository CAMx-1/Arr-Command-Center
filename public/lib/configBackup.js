import { getConnections, replaceConnectionsSecure } from './connections.js';
import { collectSafeUiPreferences, normalizeLocalFallbackSnapshot } from './fallbackSync.js';

const FORMAT = 'arrcc-encrypted-backup';
const ITERATIONS = 250000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const subtle = () => globalThis.crypto?.subtle;
const bytesToBase64 = (bytes) => { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); };
const base64ToBytes = (value) => { const raw = atob(value); return Uint8Array.from(raw, (char) => char.charCodeAt(0)); };
async function derive(passphrase, salt, usages) {
  if (!subtle()) throw new Error('Encrypted backup is unavailable in this environment');
  const material = await subtle().importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, usages);
}
export function portableBackupPayload(storage, options = {}) {
  return { version: 1, exportedAt: new Date(options.now ?? Date.now()).toISOString(), connections: getConnections(storage), preferences: collectSafeUiPreferences(storage, { dashboardUser: options.dashboardUser }) };
}
export async function encryptPortableBackup(payload, passphrase) {
  if (String(passphrase || '').length < 8) throw new Error('Backup passphrase must be at least 8 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt, ['encrypt']);
  const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  return { format: FORMAT, version: 1, kdf: { name: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: bytesToBase64(salt) }, cipher: { name: 'AES-256-GCM', iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) } };
}
export async function decryptPortableBackup(envelope, passphrase) {
  if (!envelope || envelope.format !== FORMAT || envelope.version !== 1 || envelope.kdf?.iterations !== ITERATIONS) throw new Error('Unsupported or invalid ArrCC backup file');
  if (String(passphrase || '').length < 8) throw new Error('Backup passphrase must be at least 8 characters');
  try {
    const salt = base64ToBytes(envelope.kdf.salt); const iv = base64ToBytes(envelope.cipher.iv); const data = base64ToBytes(envelope.cipher.data);
    if (salt.length !== 16 || iv.length !== 12 || data.length > 5_000_000) throw new Error('Invalid encrypted payload');
    const key = await derive(passphrase, salt, ['decrypt']);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv }, key, data);
    const payload = JSON.parse(decoder.decode(plain));
    return validatePortableBackup(payload);
  } catch (error) { if (/Unsupported|passphrase|payload/.test(error.message)) throw error; throw new Error('Could not decrypt backup. Check the passphrase and file.'); }
}
export function validatePortableBackup(payload) {
  if (!payload || payload.version !== 1 || !payload.connections || typeof payload.connections !== 'object') throw new Error('Invalid ArrCC backup contents');
  const normalized = normalizeLocalFallbackSnapshot({ version: 1, syncedAt: payload.exportedAt, sourceGeneratedAt: payload.exportedAt, connections: payload.connections, preferences: payload.preferences || {}, skipped: [] });
  return { version: 1, exportedAt: payload.exportedAt, connections: normalized.connections, preferences: normalized.preferences };
}
export async function applyPortableBackup(payload, storage) {
  const normalized = validatePortableBackup(payload);
  await replaceConnectionsSecure(normalized.connections, storage);
  const target = storage || globalThis.localStorage;
  for (const [key, value] of Object.entries(normalized.preferences)) target.setItem(key, value);
  return { serviceCount: Object.keys(normalized.connections).length, exportedAt: normalized.exportedAt };
}
