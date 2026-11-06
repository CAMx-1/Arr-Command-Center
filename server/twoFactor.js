// Two-factor codes (TOTP, RFC 6238) and the sign-in session list.
// TOTP uses SHA-1, 30-second steps and 6 digits, which every authenticator
// app supports. A code is accepted one step either side of now (clock drift)
// and never twice. Recovery codes are stored only as SHA-256 hashes.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Not base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms, period = 30) => Math.floor(ms / 1000 / period);
export const totp = (secret, ms = Date.now()) => hotp(secret, stepAt(ms));

// The step a code matches (now ±window), or null. Pass lastStep to refuse
// a code that was already used.
export function checkTotp(secret, code, { now = Date.now(), window = 1, lastStep = -1 } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const s = stepAt(now);
  for (let d = -window; d <= window; d++) {
    const step = s + d;
    if (step <= lastStep) continue;
    const want = hotp(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return step;
  }
  return null;
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));
export function otpauthUrl(secret, account, issuer = 'Arr Command Center') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

const hashCode = (c) => crypto.createHash('sha256').update(String(c).toLowerCase().replace(/[\s-]/g, '')).digest('hex');
export function newRecoveryCodes(n = 10) {
  const codes = Array.from({ length: n }, () => { const s = crypto.randomBytes(5).toString('hex'); return `${s.slice(0, 5)}-${s.slice(5)}`; });
  return { codes, hashes: codes.map(hashCode) };
}
// Returns the remaining hashes when the code matches one, else null.
export function useRecoveryCode(hashes, code) {
  const hc = hashCode(code);
  const i = (hashes || []).indexOf(hc);
  return i < 0 ? null : hashes.filter((_, k) => k !== i);
}

// ------------------------------------------------------------ sessions
// Stored in the auth store under "sessions": { id: { user, created, lastSeen,
// ip, ua, mfa } }. The id goes inside the signed cookie, so removing the
// record signs that browser out on its next request.
const SESSION_NS = 'sessions';
const TOUCH_MS = 5 * 60000;

export function createSessions(store, { ttlMs, now = () => Date.now() }) {
  const all = () => store.get(SESSION_NS, {}) || {};
  const save = (v) => store.set(SESSION_NS, v);
  const prune = (map) => { const t = now(); for (const [id, s] of Object.entries(map)) if (!s || t - s.created > ttlMs) delete map[id]; return map; };
  return {
    create(user, { ip = '', ua = '', mfa = false } = {}) {
      const map = prune(all());
      const id = crypto.randomBytes(18).toString('base64url');
      map[id] = { user, created: now(), lastSeen: now(), ip: String(ip).slice(0, 64), ua: String(ua).slice(0, 300), mfa: !!mfa };
      save(map);
      return id;
    },
    get(id) { const s = id ? all()[id] : null; return s && now() - s.created <= ttlMs ? s : null; },
    // Update lastSeen at most every few minutes, so requests don't each write.
    touch(id, ip) {
      const map = all(); const s = map[id];
      if (!s || now() - s.lastSeen < TOUCH_MS) return;
      s.lastSeen = now(); if (ip) s.ip = String(ip).slice(0, 64); save(map);
    },
    revoke(id) { const map = all(); if (!map[id]) return false; delete map[id]; save(map); return true; },
    revokeUser(user, { except } = {}) {
      const map = all(); let n = 0;
      for (const [id, s] of Object.entries(map)) if (s.user.toLowerCase() === String(user).toLowerCase() && id !== except) { delete map[id]; n++; }
      if (n) save(map);
      return n;
    },
    list(user) {
      return Object.entries(prune(all())).filter(([, s]) => !user || s.user.toLowerCase() === String(user).toLowerCase())
        .map(([id, s]) => ({ id, ...s })).sort((a, b) => b.lastSeen - a.lastSeen);
    },
  };
}

// "Safari on iPhone", "Chrome on Windows", … for the session list.
export function describeAgent(ua) {
  const u = String(ua || '');
  if (/ArrCommandCenter|Capacitor/i.test(u)) return 'iOS app';
  // Apps that show web pages themselves (the iOS app, in-app browsers) leave out "Safari/".
  if (/iPhone|iPad/.test(u) && !/Safari\//.test(u)) return `App on ${/iPad/.test(u) ? 'iPad' : 'iPhone'}`;
  const browser = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : u ? 'Browser' : 'Unknown';
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac OS X/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
