// Basic-auth gate hardening: constant-time credential comparison and a
// per-client failed-attempt limiter (lockout with exponential backoff), so the
// password can't be brute-forced or timed.
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();

// Constant-time string equality (hashing first makes lengths equal).
export function safeEqual(a, b) {
  return timingSafeEqual(digest(a), digest(b));
}

// After `maxFailures` misses inside `windowMs`, a client is locked out for
// `baseLockMs`, doubling on each further lockout up to `maxLockMs`. Success
// clears the record. Memory is bounded by pruning idle entries.
export function createAuthLimiter({ maxFailures = 10, windowMs = 15 * 60000, baseLockMs = 60000, maxLockMs = 60 * 60000, maxEntries = 10000, now = Date.now } = {}) {
  const clients = new Map(); // id -> { fails, first, lockedUntil, lockouts }
  const prune = () => {
    if (clients.size < maxEntries) return;
    const t = now();
    for (const [id, c] of clients) if (c.lockedUntil < t && t - c.first > windowMs) clients.delete(id);
    while (clients.size >= maxEntries) clients.delete(clients.keys().next().value);
  };
  return {
    // ms remaining on a lockout, or 0 when the client may try.
    blockedFor(id) {
      const c = clients.get(id);
      return c && c.lockedUntil > now() ? c.lockedUntil - now() : 0;
    },
    fail(id) {
      const t = now();
      let c = clients.get(id);
      if (!c || t - c.first > windowMs) { prune(); c = { fails: 0, first: t, lockedUntil: 0, lockouts: c ? c.lockouts : 0 }; clients.set(id, c); }
      c.fails += 1;
      if (c.fails >= maxFailures) {
        c.lockedUntil = t + Math.min(maxLockMs, baseLockMs * 2 ** c.lockouts);
        c.lockouts += 1;
        c.fails = 0;
        c.first = t;
      }
    },
    succeed(id) { clients.delete(id); },
    size: () => clients.size,
  };
}
