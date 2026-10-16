// Response redaction for the service proxy.
//
// The proxy injects each service's credentials (API key, query apikey, Basic
// password, Cloudflare Access secret, custom header values) into upstream
// requests. Some upstreams reflect the request back — SABnzbd/Tautulli error
// pages echo the URL including ?apikey=, debug endpoints echo headers — which
// would hand those secrets to the browser. Text responses are streamed through
// a transform that replaces any of this service's secrets with "[redacted]",
// handling matches split across chunk boundaries. Binary bodies (images,
// archives) pass through untouched.
import { Transform } from 'node:stream';

const MIN_SECRET = 8; // shorter values are too likely to collide with real data
export const REDACTED = '[redacted]';

// Every credential the proxy may send for this service, plus the encodings
// they could be reflected in (URL-encoded, Basic base64).
export function secretsFor(svc, extra = []) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.length >= MIN_SECRET) out.add(v); };
  add(svc.apiKey);
  add(svc.password);
  add(svc.token);
  if (svc.cloudflareAccess) add(svc.cloudflareAccess.clientSecret);
  for (const v of Object.values(svc.customHeaders || {})) add(v);
  for (const v of extra) add(v);
  if (svc.username || svc.password) add(Buffer.from(`${svc.username || ''}:${svc.password || ''}`).toString('base64'));
  for (const v of [...out]) { const enc = encodeURIComponent(v); if (enc !== v) out.add(enc); }
  return [...out].sort((a, b) => b.length - a.length);
}

export function isTextual(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (!ct) return true; // unknown: treat as text (error pages often omit it)
  return /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|html/.test(ct);
}

export function redactString(text, secrets) {
  let out = text;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join(REDACTED);
  return out;
}

// Streaming redactor. Keeps (longest secret - 1) bytes of tail between chunks
// so a secret split across a boundary is still caught. Works on latin1 strings
// so multi-byte UTF-8 is never split or re-encoded (secrets are ASCII).
export function createRedactor(secrets) {
  const list = secrets.filter(Boolean);
  const keep = list.reduce((m, s) => Math.max(m, s.length), 0) - 1;
  let carry = '';
  return new Transform({
    transform(chunk, _enc, cb) {
      const text = redactString(carry + chunk.toString('latin1'), list);
      if (keep <= 0) { carry = ''; return cb(null, Buffer.from(text, 'latin1')); }
      const cut = Math.max(0, text.length - keep);
      carry = text.slice(cut);
      cb(null, Buffer.from(text.slice(0, cut), 'latin1'));
    },
    flush(cb) { cb(null, Buffer.from(redactString(carry, list), 'latin1')); },
  });
}
