// Signed, single-use, expiring tokens for notification action buttons
// (ntfy "Approve" / "Decline"). The phone's ntfy app — or ntfy's server —
// calls POST /api/notify/action/<token> without a dashboard session, so the
// token itself is the authorization: HMAC-SHA256 over { service, request,
// action, expiry, nonce }, scoped to exactly one Seerr request + action, and
// rejected once used (nonces persisted until expiry).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as store from './store.js';

const ACTIONS = new Set(['approve', 'decline']);
const USED_NS = 'actionTokensUsed';

export function createActionTokens({ secret, ttlMs = 48 * 3600000, now = Date.now, persist = false } = {}) {
  if (!secret || secret.length < 16) throw new Error('action token secret too short');
  const used = new Map(Object.entries(persist ? store.get(USED_NS, {}) || {} : {})); // nonce -> exp
  const sign = (p) => createHmac('sha256', secret).update(p).digest('base64url');
  const saveUsed = () => {
    const t = now();
    for (const [n, exp] of used) if (exp < t) used.delete(n);
    if (persist) store.set(USED_NS, Object.fromEntries(used));
  };
  const api = {
    issue({ service, requestId, action }) {
      if (!ACTIONS.has(action)) throw new Error('unsupported action');
      const payload = { s: String(service), r: Number(requestId), a: action, exp: now() + ttlMs, n: randomBytes(9).toString('base64url') };
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${p}.${sign(p)}`;
    },
    // services = cfg.services; returns { ok, payload } or { error }
    redeem(token, services) {
      const [p, sig] = String(token || '').split('.');
      if (!p || !sig) return { error: 'invalid' };
      const a = Buffer.from(sig); const b = Buffer.from(sign(p));
      if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: 'invalid' };
      let payload;
      try { payload = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return { error: 'invalid' }; }
      if (!ACTIONS.has(payload.a) || !Number.isInteger(payload.r)) return { error: 'invalid' };
      if (!payload.exp || payload.exp < now()) return { error: 'expired' };
      if (used.has(payload.n)) return { error: 'already used' };
      const svc = services && services[payload.s];
      if (!svc || svc.type !== 'overseerr' || svc.enabled === false) return { error: 'unknown service' };
      used.set(payload.n, payload.exp); saveUsed();
      api.lastRedeemed = { ok: true, payload };
      return api.lastRedeemed;
    },
  };
  return api;
}
