// Shared custom-header validation for server proxy and local direct mode.
// User headers are always applied first; generated service auth and Cloudflare
// Access headers are applied afterward so required credentials cannot be replaced.

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED = new Set(['host', 'content-length', 'cookie', 'set-cookie', 'connection', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate']);
const PROTECTED = new Set(['cf-access-client-id', 'cf-access-client-secret']);
export const MAX_CUSTOM_HEADERS = 20;

export function normalizeCustomHeaders(input, { rejectProtected = true } = {}) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('customHeaders must be an object');
  const output = {};
  const seen = new Set();
  const entries = Object.entries(input);
  if (entries.length > MAX_CUSTOM_HEADERS) throw new Error(`customHeaders supports at most ${MAX_CUSTOM_HEADERS} entries`);
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName || '').trim();
    const lower = name.toLowerCase();
    if (!name || name.length > 100 || !HEADER_NAME.test(name)) throw new Error(`Invalid custom header name: ${name || '(empty)'}`);
    if (RESERVED.has(lower)) throw new Error(`Custom header is reserved: ${name}`);
    if (PROTECTED.has(lower)) {
      if (rejectProtected) throw new Error(`${name} must be configured through Cloudflare Access fields`);
      continue;
    }
    if (seen.has(lower)) throw new Error(`Duplicate custom header: ${name}`);
    const value = String(rawValue ?? '').trim();
    if (!value) continue;
    if (value.length > 1000) throw new Error(`Custom header value is too long: ${name}`);
    if(/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Custom header contains control characters: ${name}`);
    seen.add(lower);
    output[name] = value;
  }
  return output;
}

export function mergeProtectedHeaders(customHeaders, serviceHeaders, cloudflareHeaders) {
  return { ...normalizeCustomHeaders(customHeaders), ...(serviceHeaders || {}), ...(cloudflareHeaders || {}) };
}

export function hasCustomHeaders(value) {
  try { return Object.keys(normalizeCustomHeaders(value)).length > 0; }
  catch { return false; }
}
