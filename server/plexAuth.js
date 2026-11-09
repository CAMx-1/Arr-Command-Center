// Optional "Sign in with Plex" gate for the whole dashboard.
// Uses Plex's OAuth PIN flow entirely server-side, so the Plex auth token never
// touches the browser. On success the browser receives a signed, HttpOnly session
// cookie. Access can be restricted to an allowlist of Plex usernames/emails.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import { writeFileAtomic } from './store.js';
import { createRoleDirectory } from './roles.js';
import { createAuthLimiter } from './authGuard.js';
import { createSessions, checkTotp, newSecret, otpauthUrl, newRecoveryCodes, useRecoveryCode, describeAgent } from './twoFactor.js';
import { rpIdFor, registrationOptions, authenticationOptions, verifyRegistration, verifyAuthentication } from './webauthn.js';

const PLEX_API = 'https://plex.tv/api/v2';
const COOKIE = 'acc_session';
const MFA_COOKIE = 'acc_mfa';
const DEVICE_COOKIE = 'acc_device';
const DEVICES_NS = 'signInDevices';
const DEVICE_DAYS = 400; // the longest browsers keep a cookie
const TF_NS = 'twoFactor';
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
const STATE_FILE = 'auth-state.json';

// Persist a stable Plex client identifier + session secret across restarts.
// Lives in the data directory (a mounted volume in Docker): the app root is not
// writable by the container's non-root user, so state written there was lost on
// every rebuild — signing everyone out and registering a new Plex "device".
// A legacy <root>/.auth-state.json is migrated so existing sessions survive.
function loadState(root, dataDir) {
  const file = path.join(dataDir, STATE_FILE);
  const read = (f) => { try { const s = JSON.parse(fs.readFileSync(f, 'utf8')); return s && s.clientId && s.sessionSecret ? s : null; } catch { return null; } };
  let state = read(file);
  if (state) return state;
  const legacy = read(path.join(root, '.auth-state.json'));
  state = legacy || { clientId: crypto.randomUUID(), sessionSecret: crypto.randomBytes(32).toString('hex') };
  try {
    writeFileAtomic(file, JSON.stringify(state, null, 2));
    if (legacy) console.log(`[auth] migrated sign-in state to ${file}`);
  } catch (e) {
    console.warn(`[auth] could not persist sign-in state to ${file} (${e.message}); sessions will reset on restart. Mount a writable data volume or set SESSION_SECRET.`);
  }
  return state;
}

function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try { return decodeURIComponent(v.join('=')); } catch { return null; }
    }
  }
  return null;
}

function plexHeaders(clientId, product) {
  return {
    'X-Plex-Product': product,
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Version': '1.0',
    Accept: 'application/json',
  };
}

export function createPlexAuth(cfg, { root, publicDir, dataDir = path.join(root, 'data'), authStore = store, onNewDevice = () => {} }) {
  const pcfg = (cfg.auth && cfg.auth.plex) || {};
  const enabled = !!pcfg.enabled;
  const product = pcfg.product || 'Arr Command Center';
  const allowed = (pcfg.allowedUsers || []).map((u) => String(u).toLowerCase().trim()).filter(Boolean);
  const roles = createRoleDirectory(cfg, authStore);
  const ttlSeconds = (pcfg.sessionDays || 30) * 86400;
  const secureCookies = !!pcfg.secureCookies || process.env.SECURE_COOKIES === 'true';
  const allowAny = !!pcfg.allowAnyPlexUser || process.env.PLEX_ALLOW_ANY === 'true';

  // Fail-closed by default: an empty allowlist denies all logins unless the
  // operator explicitly opts into open access.
  const managedCount = () => { const l = typeof authStore.get === 'function' ? authStore.get('plexUsers', []) : []; return Array.isArray(l) ? l.length : 0; };
  if (enabled && !allowed.length && !allowAny && !managedCount()) {
    console.warn('[auth] Plex auth is ENABLED but the allowlist is EMPTY and allowAnyPlexUser is false — all logins will be DENIED. Add auth.plex.allowedUsers, or set auth.plex.allowAnyPlexUser: true to allow any Plex account.');
  } else if (enabled && allowAny && !allowed.length) {
    console.warn('[auth] Plex auth is ENABLED with allowAnyPlexUser=true — ANY Plex account can sign in. Set auth.plex.allowedUsers to restrict access.');
    if (!managedCount()) console.warn('[auth] No admin is listed, so every signed-in Plex user is an admin. Add yourself as an admin in Settings → Users & roles (or auth.plex.allowedUsers) to apply roles.');
  }

  const state = loadState(root, dataDir);
  const clientId = pcfg.clientId || state.clientId;
  const secret = process.env.SESSION_SECRET || pcfg.sessionSecret || state.sessionSecret;

  // Sessions and two-factor records live in the auth store; a write-only store
  // (some tests) gets an in-memory stand-in for them.
  const mem = {};
  const kv = typeof authStore.get === 'function' ? authStore : { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; return v; } };
  const sessions = createSessions(kv, { ttlMs: ttlSeconds * 1000 });
  // Two-factor records: { [user]: { secret, enabledAt, lastStep, recovery: [hash], pending: { secret, at } } }
  const tfKey = (u) => String(u || '').toLowerCase();
  const tfGet = (u) => ((kv.get(TF_NS, {}) || {})[tfKey(u)]) || {};
  const tfSet = (u, v) => { const all = { ...(kv.get(TF_NS, {}) || {}) }; if (v) all[tfKey(u)] = v; else delete all[tfKey(u)]; kv.set(TF_NS, all); };
  // Two-factor is on when there's an authenticator app or at least one passkey.
  const tfOn = (u) => { const r = tfGet(u); return !!r.secret || !!(r.passkeys && r.passkeys.length); };
  const VERIFY_MS = 10 * 60000; // how long "confirm it's you" lasts
  const rpIdOf = (req) => rpIdFor(req.headers.host);
  const passkeyView = (p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt || null, synced: !!p.synced, rpId: p.rpId });
  // A passkey response: check it against the user's own passkeys for this site.
  function checkPasskey(u, credential, challenge, rpId) {
    const rec = tfGet(u);
    const stored = (rec.passkeys || []).find((x) => credential && x.id === credential.id && x.rpId === rpId);
    if (!stored) throw new Error('That passkey isn’t set up for this account on this site');
    const r = verifyAuthentication({ credential, challenge, rpId, stored });
    tfSet(u, { ...rec, passkeys: rec.passkeys.map((x) => (x.id === stored.id ? { ...x, signCount: r.signCount, lastUsedAt: Date.now() } : x)) });
    return stored;
  }
  const codeLimiter = createAuthLimiter({ maxFailures: 5, windowMs: 15 * 60000, baseLockMs: 5 * 60000 });
  // Plex sign-ins waiting for a two-factor code: nonce -> { uname, email, token, exp, tries }
  const pendingMfa = new Map();

  function sign(username, email, sid) {
    const payload = Buffer.from(JSON.stringify({ u: username, ...(email ? { e: email } : {}), ...(sid ? { s: sid } : {}), exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  function verify(token) {
    if (!token) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const { u, e, s, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (!exp || exp < Math.floor(Date.now() / 1000)) return null;
      return u ? { username: u, email: e || '', sid: s || null } : null;
    } catch { return null; }
  }

  function plainCookie(name, value, maxAge, cookiePath) {
    const age = Math.max(0, Math.floor(Number(maxAge) || 0));
    return [`${name}=${encodeURIComponent(value)}`, `Path=${cookiePath}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${age}`, ...(secureCookies ? ['Secure'] : [])].join('; ');
  }
  function sessionCookie(value, maxAge) {
    const age = Math.max(0, Math.floor(Number(maxAge) || 0));
    // Native launches enter from capacitor://localhost, which is cross-site to
    // the HTTPS server. Lax includes this cookie on that safe top-level GET,
    // while still withholding it from cross-site POST/fetch requests. Expires
    // complements Max-Age for persistent-cookie compatibility in WKWebView.
    const expires = age > 0 ? new Date(Date.now() + age * 1000) : new Date(0);
    const parts = [
      `${COOKIE}=${encodeURIComponent(value)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${age}`,
      `Expires=${expires.toUTCString()}`,
    ];
    if (secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  // Allowed = has a role (config allowlist, a Settings-managed user, or
  // allowAnyPlexUser). Empty lists fail closed unless allowAnyPlexUser.
  function isAllowed(user) { return roles.isAllowed(user.username, user.email); }
  // Re-checked on every request, so removing a user or changing a role takes
  // effect immediately instead of when the session cookie expires.
  // Cookies from before the session list have no id. Each one is tied to one
  // stored session the first time it's seen (so a page's parallel requests
  // don't each start a session) and after that works only while that session
  // exists, so signing it out ends the old cookie too.
  const LEGACY_NS = 'sessionsLegacy';
  const legacyId = (raw) => crypto.createHash('sha256').update(String(raw)).digest('base64url').slice(0, 32);
  function legacySession(raw, user, req) {
    const map = { ...(kv.get(LEGACY_NS, {}) || {}) };
    const id = legacyId(raw);
    if (map[id]) return sessions.get(map[id].sid) ? map[id].sid : null;
    const cutoff = Date.now() - ttlSeconds * 1000;
    for (const [k, v] of Object.entries(map)) if (!v || v.at < cutoff) delete map[k];
    const sid = sessions.create(user.username, { ip: clientIp(req), ua: req.headers['user-agent'] || '' });
    map[id] = { sid, at: Date.now() };
    kv.set(LEGACY_NS, map);
    return sid;
  }

  // Each cookie names a stored session; signing out a session (or the
  // account) removes it, which ends that cookie at once. Old cookies are
  // upgraded (above), except for accounts with two-factor on, which must
  // sign in again.
  function sessionUser(req) {
    const s = verify(getCookie(req, COOKIE));
    if (!s) return null;
    const role = roles.lookup(s.username, s.email);
    if (!role) return null;
    if (s.sid) {
      const rec = sessions.get(s.sid);
      if (!rec || rec.user.toLowerCase() !== s.username.toLowerCase()) return null;
      return { ...s, role, session: rec };
    }
    if (tfOn(s.username)) return null;
    const sid = legacySession(getCookie(req, COOKIE), s, req);
    return sid ? { ...s, role, sid, session: sessions.get(sid), upgrade: true } : null;
  }

  // ---- New-device sign-in alerts ----
  // Each browser gets a long-lived random device cookie (only its hash is
  // stored). A sign-in from a browser the account hasn't used before calls
  // onNewDevice, unless it's the account's first browser. Browsers that are
  // already signed in are remembered as they're used, so the ones signed in
  // before this existed don't set off an alert later.
  const deviceRaw = (req) => { const v = getCookie(req, DEVICE_COOKIE); return v && /^[\w-]{20,64}$/.test(v) ? v : null; };
  const deviceHash = (raw) => crypto.createHash('sha256').update(raw).digest('base64url').slice(0, 32);
  const deviceCookie = (raw) => plainCookie(DEVICE_COOKIE, raw, DEVICE_DAYS * 86400, '/');
  const devGet = (u) => { const r = ((kv.get(DEVICES_NS, {}) || {})[tfKey(u)]) || {}; return { alerts: r.alerts !== false, devices: Array.isArray(r.devices) ? r.devices : [] }; };
  const devSet = (u, v) => { const all = { ...(kv.get(DEVICES_NS, {}) || {}) }; all[tfKey(u)] = v; kv.set(DEVICES_NS, all); };
  // Remember this browser for the account. Returns true when a sign-in
  // from it should alert.
  function noteDevice(u, raw, req, signIn = false) {
    const rec = devGet(u); const id = deviceHash(raw); const now = Date.now();
    const known = rec.devices.find((d) => d.id === id);
    if (known) {
      if (now - known.lastSeen > 86400000) { known.lastSeen = now; known.ip = clientIp(req); known.name = describeAgent(req.headers['user-agent']); devSet(u, rec); }
      return false;
    }
    const first = rec.devices.length === 0;
    rec.devices = [...rec.devices, { id, name: describeAgent(req.headers['user-agent']), firstSeen: now, lastSeen: now, ip: clientIp(req) }]
      .sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 20);
    devSet(u, rec);
    return signIn && !first && rec.alerts;
  }

  // Finish a sign-in: keep the Plex token server-side, log it, start a session.
  // A sign-in with two-factor counts as "confirm it's you" for 10 minutes.
  function completeSignIn(req, res, { uname, email, token, mfa }, extraCookies = []) {
    try { authStore.set('plex', { token, user: uname, at: Date.now() }); } catch { /* best effort */ }
    const ua = req.headers['user-agent'] || '';
    let raw = deviceRaw(req); const deviceCookies = [];
    if (!raw) { raw = crypto.randomBytes(18).toString('base64url'); deviceCookies.push(deviceCookie(raw)); }
    let newDevice = false;
    try { newDevice = noteDevice(uname, raw, req, true); } catch { /* best effort */ }
    try { authStore.push('loginLog', { user: uname, at: Date.now(), ip: clientIp(req), ua, device: describeAgent(ua), ...(mfa ? { mfa: true } : {}), ...(newDevice ? { newDevice: true } : {}) }); } catch { /* best effort */ }
    const sid = sessions.create(uname, { ip: clientIp(req), ua, mfa, verifiedAt: mfa ? Date.now() : null });
    res.setHeader('Set-Cookie', [sessionCookie(sign(uname, email, sid), ttlSeconds), ...extraCookies, ...deviceCookies]);
    if (newDevice) {
      try { onNewDevice({ user: uname, email, role: roles.lookup(uname, email), device: describeAgent(ua), ip: clientIp(req), at: Date.now(), mfa: !!mfa }); } catch { /* never block a sign-in */ }
    }
    return sid;
  }

  // ---- Router: /api/auth/* ----
  const router = express.Router();
  router.use(express.json());

  router.get('/me', (req, res) => {
    const s = enabled ? sessionUser(req) : null;
    res.json({ enabled, user: s ? s.username : null, role: enabled ? (s ? s.role : null) : 'admin' });
  });

  router.post('/plex/pin', async (req, res) => {
    if (!enabled) return res.status(400).json({ error: 'Plex auth is disabled' });
    try {
      const r = await fetch(`${PLEX_API}/pins?strong=true`, { method: 'POST', headers: plexHeaders(clientId, product) });
      const data = await r.json();
      if (!data || !data.id) return res.status(502).json({ error: 'Could not create Plex PIN' });
      let authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}&code=${encodeURIComponent(data.code)}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(product)}`;
      // Optional forwardUrl: after the user authorizes, Plex redirects the
      // top-level page back here. This is what makes the flow work inside the
      // native WKWebView (and Safari), where popups/new tabs are unreliable —
      // login.js navigates the whole WebView to Plex and resumes on return.
      // Only accept same-origin http(s) forward targets to avoid open-redirects.
      const fwd = (req.body && req.body.forwardUrl) || '';
      if (fwd && /^https?:\/\//i.test(fwd)) {
        try {
          const u = new URL(fwd);
          const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
          if (!host || u.host === host) {
            authUrl += `&forwardUrl=${encodeURIComponent(fwd)}`;
          }
        } catch { /* ignore malformed forwardUrl */ }
      }
      res.json({ pinId: data.id, code: data.code, authUrl });
    } catch (e) {
      res.status(502).json({ error: 'Plex request failed: ' + e.message });
    }
  });

  router.get('/plex/check', async (req, res) => {
    if (!enabled) return res.status(400).json({ error: 'Plex auth is disabled' });
    const { pinId, code } = req.query;
    if (!pinId || !code) return res.status(400).json({ error: 'Missing pinId/code' });
    try {
      const r = await fetch(`${PLEX_API}/pins/${encodeURIComponent(pinId)}?code=${encodeURIComponent(code)}`, { headers: plexHeaders(clientId, product) });
      const data = await r.json();
      if (!data || !data.authToken) return res.json({ authorized: false });

      const ur = await fetch(`${PLEX_API}/user`, { headers: { ...plexHeaders(clientId, product), 'X-Plex-Token': data.authToken } });
      const user = await ur.json();
      if (!user || (!user.username && !user.email)) return res.status(502).json({ authorized: false, error: 'Could not read Plex account' });

      if (!isAllowed(user)) {
        return res.status(403).json({ authorized: false, error: 'This Plex account is not permitted to access this dashboard.' });
      }
      // The Plex token is kept server-side (never sent to the browser) so the
      // dashboard can call the Plex API (watchlist, users, sessions).
      const uname = user.username || user.email;
      const email = user.username ? user.email : '';
      if (tfOn(uname)) {
        // Plex said yes; now the authenticator code. Nothing is stored and no
        // session starts until the code is right.
        const nonce = crypto.randomBytes(24).toString('base64url');
        for (const [k, v] of pendingMfa) if (v.exp < Date.now()) pendingMfa.delete(k);
        pendingMfa.set(nonce, { uname, email, token: data.authToken, exp: Date.now() + 5 * 60000, tries: 0 });
        res.setHeader('Set-Cookie', plainCookie(MFA_COOKIE, nonce, 300, '/api/auth'));
        const rec = tfGet(uname); const rpId = rpIdOf(req);
        return res.json({ authorized: false, mfaRequired: true, user: { username: user.username },
          methods: { code: !!rec.secret, recovery: (rec.recovery || []).length > 0, passkey: !!rpId && (rec.passkeys || []).some((x) => x.rpId === rpId) } });
      }
      completeSignIn(req, res, { uname, email, token: data.authToken, mfa: false });
      res.json({ authorized: true, user: { username: user.username, email: user.email, thumb: user.thumb } });
    } catch (e) {
      res.status(502).json({ authorized: false, error: 'Plex request failed: ' + e.message });
    }
  });

  // Passkey for the second step: the challenge to sign.
  router.post('/2fa/passkey/options', (req, res) => {
    if (!enabled) return res.status(400).json({ error: 'Plex auth is disabled' });
    const nonce = getCookie(req, MFA_COOKIE);
    const p = nonce && pendingMfa.get(nonce);
    if (!p || p.exp < Date.now()) return res.status(401).json({ error: 'This sign-in has expired. Start again with Plex.' });
    const rpId = rpIdOf(req);
    const mine = (tfGet(p.uname).passkeys || []).filter((x) => x.rpId === rpId);
    if (!rpId || !mine.length) return res.status(400).json({ error: 'No passkey is set up for this account on this address.' });
    const opts = authenticationOptions({ rpId, credentials: mine });
    p.challenge = opts.challenge; p.rpId = rpId;
    res.json(opts);
  });

  // Second step of sign-in: a code from the authenticator app, a recovery
  // code, or a passkey.
  router.post('/2fa', (req, res) => {
    if (!enabled) return res.status(400).json({ error: 'Plex auth is disabled' });
    const nonce = getCookie(req, MFA_COOKIE);
    const p = nonce && pendingMfa.get(nonce);
    if (!p || p.exp < Date.now()) return res.status(401).json({ error: 'This sign-in has expired. Start again with Plex.' });
    const limitKey = `2fa:${tfKey(p.uname)}`;
    const wait = codeLimiter.blockedFor(limitKey);
    if (wait) return res.status(429).json({ error: `Too many wrong codes. Try again in ${Math.ceil(wait / 60000)} min.` });
    const rec = tfGet(p.uname);
    const code = String((req.body && req.body.code) || '').trim();
    let ok = false; let usedRecovery = false; let why = '';
    if (req.body && req.body.passkey) {
      try { checkPasskey(p.uname, req.body.passkey, p.challenge, p.rpId); ok = true; } catch (e) { why = e.message; }
      p.challenge = null; // single use
    } else {
      const step = rec.secret ? checkTotp(rec.secret, code, { lastStep: rec.lastStep ?? -1 }) : null;
      if (step !== null) { tfSet(p.uname, { ...rec, lastStep: step }); ok = true; }
      else { const left = useRecoveryCode(rec.recovery, code); if (left) { tfSet(p.uname, { ...tfGet(p.uname), recovery: left }); ok = true; usedRecovery = true; } }
    }
    if (!ok) {
      codeLimiter.fail(limitKey);
      if (++p.tries >= 5) pendingMfa.delete(nonce);
      return res.status(401).json({ error: p.tries >= 5 ? 'Too many tries. Start again with Plex.' : why || 'That code didn’t work. Check the time on your phone and try the newest code.' });
    }
    codeLimiter.succeed(limitKey);
    pendingMfa.delete(nonce);
    completeSignIn(req, res, { uname: p.uname, email: p.email, token: p.token, mfa: true }, [plainCookie(MFA_COOKIE, '', 0, '/api/auth')]);
    res.json({ authorized: true, recoveryLeft: usedRecovery ? (tfGet(p.uname).recovery || []).length : undefined });
  });

  router.post('/logout', (req, res) => {
    const s = verify(getCookie(req, COOKIE));
    if (s && s.sid) sessions.revoke(s.sid);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ ok: true });
  });

  // ---- Gate middleware ----
  const ALLOW_UNAUTH = new Set(['/login.html', '/login.js', '/login.css', '/styles.css', '/favicon.ico', '/robots.txt', '/sw.js', '/manifest.webmanifest']);
  function middleware(req, res, next) {
    if (!enabled) return next();
    const p = req.path;
    if (p.startsWith('/api/auth/')) return next();
    if (ALLOW_UNAUTH.has(p) || p.startsWith('/icons/')) return next();

    // Keep this private dashboard — and especially the branded sign-in page —
    // out of search-engine indexes and Safe Browsing crawls.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    const user = sessionUser(req);
    if (user) {
      req.plexUser = user.username; req.plexRole = user.role; req.plexEmail = user.email || null;
      req.plexSession = user.sid;
      if (user.upgrade) res.append('Set-Cookie', sessionCookie(sign(user.username, user.email, user.sid), ttlSeconds));
      else sessions.touch(user.sid, clientIp(req));
      // Remember this browser for the account (no alert: it's signed in already).
      try {
        let raw = deviceRaw(req);
        if (!raw) { raw = crypto.randomBytes(18).toString('base64url'); res.append('Set-Cookie', deviceCookie(raw)); }
        noteDevice(user.username, raw, req);
      } catch { /* best effort */ }
      return next();
    }
    if (p.startsWith('/api/')) return res.status(401).json({ error: 'Authentication required' });
    // Serve the login page with a 401 so crawlers treat it as protected and
    // don't index it as a public "deceptive login" page. No WWW-Authenticate
    // header is sent, so browsers still render the body (no basic-auth popup).
    return res.status(401).sendFile(path.join(publicDir, 'login.html'));
  }

  // ---- /api/account: your sessions and two-factor (behind the gate) ----
  const account = express.Router();
  account.use(express.json({ limit: '4kb' }));
  const off = (res) => res.status(400).json({ error: 'Sessions and two-factor need Sign in with Plex turned on.' });
  const shape = (x, me) => ({ id: x.id, user: x.user, created: x.created, lastSeen: x.lastSeen, ip: x.ip, device: describeAgent(x.ua), mfa: !!x.mfa, current: x.id === me });
  const summary = (req) => {
    const rec = tfGet(req.plexUser);
    const admin = req.plexRole === 'admin';
    const on = tfOn(req.plexUser); const rpId = rpIdOf(req);
    const sess = sessions.get(req.plexSession);
    return {
      plexAuth: true, user: req.plexUser, role: req.plexRole,
      twoFactor: { enabled: on, totp: !!rec.secret, enabledAt: rec.enabledAt || null, recoveryLeft: (rec.recovery || []).length, canEnroll: admin || on,
        passkeys: (rec.passkeys || []).map(passkeyView), passkeyDomain: rpId, verifiedUntil: sess && sess.verifiedAt ? sess.verifiedAt + VERIFY_MS : null },
      sessions: sessions.list(req.plexUser).map((x) => shape(x, req.plexSession)),
      signInAlerts: (() => {
        const d = devGet(req.plexUser); const raw = deviceRaw(req); const mine = raw ? deviceHash(raw) : null;
        return { enabled: d.alerts, devices: d.devices.map((x) => ({ id: x.id, name: x.name, firstSeen: x.firstSeen, lastSeen: x.lastSeen, ip: x.ip, current: x.id === mine })) };
      })(),
      everyone: admin ? sessions.list().map((x) => shape(x, req.plexSession)) : undefined,
    };
  };
  // "Confirm it's you" within the last 10 minutes (code, recovery code or passkey).
  const recentlyVerified = (req) => { const s = sessions.get(req.plexSession); return !!(s && s.verifiedAt && Date.now() - s.verifiedAt < VERIFY_MS); };
  // A current code (or recovery code, or a recent check) is needed to turn
  // two-factor off, remove a passkey, or make new recovery codes.
  const confirmCode = (req, res) => {
    if (recentlyVerified(req) && !(req.body && req.body.code)) return tfGet(req.plexUser);
    const limitKey = `2fa:${tfKey(req.plexUser)}`;
    if (codeLimiter.blockedFor(limitKey)) { res.status(429).json({ error: 'Too many wrong codes. Try again in a few minutes.' }); return null; }
    const rec = tfGet(req.plexUser); const code = String((req.body && req.body.code) || '').trim();
    const step = rec.secret ? checkTotp(rec.secret, code, { lastStep: rec.lastStep ?? -1 }) : null;
    if (step !== null) { codeLimiter.succeed(limitKey); return { ...rec, lastStep: step }; }
    const left = useRecoveryCode(rec.recovery, code);
    if (left) { codeLimiter.succeed(limitKey); return { ...rec, recovery: left }; }
    codeLimiter.fail(limitKey); res.status(401).json({ error: 'That code didn’t work.', needsVerification: true }); return null;
  };
  // Challenges for "confirm it's you" with a passkey, per session.
  const verifyChallenges = new Map();
  account.post('/verify/options', (req, res) => {
    if (!enabled) return off(res);
    const rec = tfGet(req.plexUser); const rpId = rpIdOf(req);
    const mine = rpId ? (rec.passkeys || []).filter((x) => x.rpId === rpId) : [];
    let passkey = null;
    if (mine.length) { passkey = authenticationOptions({ rpId, credentials: mine }); verifyChallenges.set(req.plexSession, { challenge: passkey.challenge, rpId, exp: Date.now() + 5 * 60000 }); }
    res.json({ methods: { code: !!rec.secret, recovery: (rec.recovery || []).length > 0, passkey: !!passkey }, passkey });
  });
  account.post('/verify', (req, res) => {
    if (!enabled) return off(res);
    if (!tfOn(req.plexUser)) return res.status(400).json({ error: 'Two-factor isn’t on, so there’s nothing to confirm with.' });
    const limitKey = `2fa:${tfKey(req.plexUser)}`;
    if (codeLimiter.blockedFor(limitKey)) return res.status(429).json({ error: 'Too many tries. Try again in a few minutes.' });
    if (req.body && req.body.passkey) {
      const v = verifyChallenges.get(req.plexSession); verifyChallenges.delete(req.plexSession);
      try {
        if (!v || v.exp < Date.now()) throw new Error('This passkey request has expired. Try again.');
        checkPasskey(req.plexUser, req.body.passkey, v.challenge, v.rpId);
      } catch (e) { codeLimiter.fail(limitKey); return res.status(401).json({ error: e.message }); }
    } else {
      const rec = tfGet(req.plexUser); const code = String((req.body && req.body.code) || '').trim();
      const step = rec.secret ? checkTotp(rec.secret, code, { lastStep: rec.lastStep ?? -1 }) : null;
      if (step !== null) tfSet(req.plexUser, { ...rec, lastStep: step });
      else { const left = useRecoveryCode(rec.recovery, code); if (!left) { codeLimiter.fail(limitKey); return res.status(401).json({ error: 'That code didn’t work.' }); } tfSet(req.plexUser, { ...rec, recovery: left }); }
    }
    codeLimiter.succeed(limitKey);
    sessions.update(req.plexSession, { verifiedAt: Date.now() });
    res.json({ ok: true, until: Date.now() + VERIFY_MS });
  });

  // ---- sign-in alerts ----
  account.post('/alerts', (req, res) => {
    if (!enabled) return off(res);
    const on = !!(req.body && req.body.enabled);
    // Turning alerts off is what someone else in your account would want.
    if (!on && tfOn(req.plexUser) && !recentlyVerified(req)) return res.status(403).json({ error: 'Confirm it’s you to turn sign-in alerts off.', needsVerification: true });
    devSet(req.plexUser, { ...devGet(req.plexUser), alerts: on });
    res.json(summary(req));
  });
  // Forget every browser but this one: the next sign-in anywhere else alerts.
  account.post('/devices/forget', (req, res) => {
    if (!enabled) return off(res);
    const rec = devGet(req.plexUser); const raw = deviceRaw(req); const mine = raw ? deviceHash(raw) : null;
    const kept = rec.devices.filter((d) => d.id === mine);
    devSet(req.plexUser, { ...rec, devices: kept });
    res.json({ ...summary(req), forgotten: rec.devices.length - kept.length });
  });

  // ---- passkeys ----
  account.post('/passkeys/options', (req, res) => {
    if (!enabled) return off(res);
    if (req.plexRole !== 'admin' && !tfOn(req.plexUser)) return res.status(403).json({ error: 'Two-factor is for admin accounts.' });
    const rpId = rpIdOf(req);
    if (!rpId) return res.status(400).json({ error: 'Passkeys need the dashboard to be opened by name (a domain, or localhost), not by IP address.' });
    const rec = tfGet(req.plexUser);
    if ((rec.passkeys || []).length >= 10) return res.status(400).json({ error: 'At most 10 passkeys' });
    if (tfOn(req.plexUser) && !recentlyVerified(req)) return res.status(403).json({ error: 'Confirm it’s you first.', needsVerification: true });
    const userHandle = rec.userHandle || crypto.randomBytes(16).toString('base64url');
    const opts = registrationOptions({ rpId, userHandle, userName: req.plexUser, existing: (rec.passkeys || []).filter((x) => x.rpId === rpId) });
    tfSet(req.plexUser, { ...rec, userHandle, pendingPasskey: { challenge: opts.challenge, rpId, at: Date.now() } });
    res.json(opts);
  });
  account.post('/passkeys', (req, res) => {
    if (!enabled) return off(res);
    const rec = tfGet(req.plexUser); const pend = rec.pendingPasskey;
    if (!pend || Date.now() - pend.at > 5 * 60000) return res.status(400).json({ error: 'That took too long. Try adding the passkey again.' });
    let key;
    try { key = verifyRegistration({ credential: req.body && req.body.credential, challenge: pend.challenge, rpId: pend.rpId }); }
    catch (e) { tfSet(req.plexUser, { ...rec, pendingPasskey: null }); return res.status(400).json({ error: e.message }); }
    if ((rec.passkeys || []).some((x) => x.id === key.id)) return res.status(400).json({ error: 'That passkey is already added.' });
    const wasOn = tfOn(req.plexUser);
    const name = String((req.body && req.body.name) || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60) || `${describeAgent(req.headers['user-agent'])} passkey`;
    const passkey = { ...key, name, rpId: pend.rpId, createdAt: Date.now(), lastUsedAt: null };
    const next = { ...rec, pendingPasskey: null, passkeys: [...(rec.passkeys || []), passkey] };
    let recoveryCodes; let removed = 0;
    if (!wasOn) {
      const r = newRecoveryCodes(); recoveryCodes = r.codes; next.recovery = r.hashes; next.enabledAt = Date.now();
      // Other browsers signed in without it; sign them out.
      removed = sessions.revokeUser(req.plexUser, { except: req.plexSession });
    }
    tfSet(req.plexUser, next);
    sessions.update(req.plexSession, { verifiedAt: Date.now() });
    res.json({ ...summary(req), added: passkeyView(passkey), recoveryCodes, removed });
  });
  account.delete('/passkeys/:id', (req, res) => {
    if (!enabled) return off(res);
    const rec0 = tfGet(req.plexUser);
    if (!(rec0.passkeys || []).some((x) => x.id === req.params.id)) return res.status(404).json({ error: 'No such passkey' });
    const rec = confirmCode(req, res); if (!rec) return;
    const passkeys = (rec.passkeys || []).filter((x) => x.id !== req.params.id);
    // Removing the last way in turns two-factor off.
    tfSet(req.plexUser, rec.secret || passkeys.length ? { ...rec, passkeys } : (rec.userHandle ? { userHandle: rec.userHandle } : null));
    res.json(summary(req));
  });
  account.get('/', (req, res) => { if (!enabled) return res.json({ plexAuth: false }); res.set('Cache-Control', 'no-store'); res.json(summary(req)); });
  account.delete('/sessions/:id', (req, res) => {
    if (!enabled) return off(res);
    const target = sessions.get(req.params.id);
    if (!target || (target.user.toLowerCase() !== tfKey(req.plexUser) && req.plexRole !== 'admin')) return res.status(404).json({ error: 'No such session' });
    sessions.revoke(req.params.id);
    if (req.params.id === req.plexSession) { res.setHeader('Set-Cookie', sessionCookie('', 0)); return res.json({ signedOut: true }); }
    res.json(summary(req));
  });
  account.post('/sessions/others', (req, res) => { if (!enabled) return off(res); const n = sessions.revokeUser(req.plexUser, { except: req.plexSession }); res.json({ ...summary(req), removed: n }); });
  account.post('/2fa/start', (req, res) => {
    if (!enabled) return off(res);
    if (req.plexRole !== 'admin') return res.status(403).json({ error: 'Two-factor is for admin accounts.' });
    const rec = tfGet(req.plexUser);
    if (rec.secret) return res.status(400).json({ error: 'The authenticator app is already set up.' });
    if (tfOn(req.plexUser) && !recentlyVerified(req)) return res.status(403).json({ error: 'Confirm it’s you first.', needsVerification: true });
    const secret = newSecret();
    tfSet(req.plexUser, { ...rec, pending: { secret, at: Date.now() } });
    res.json({ secret, otpauth: otpauthUrl(secret, req.plexUser) });
  });
  account.post('/2fa/confirm', (req, res) => {
    if (!enabled) return off(res);
    const rec = tfGet(req.plexUser);
    if (!rec.pending || Date.now() - rec.pending.at > 15 * 60000) return res.status(400).json({ error: 'Start the set-up again.' });
    const step = checkTotp(rec.pending.secret, req.body && req.body.code);
    if (step === null) return res.status(401).json({ error: 'That code didn’t work. Check the time on your phone and try the newest code.' });
    if (tfOn(req.plexUser)) {
      // Passkeys were already on: add the app, keep the recovery codes.
      tfSet(req.plexUser, { ...rec, pending: null, secret: rec.pending.secret, lastStep: step });
      return res.json({ ...summary(req), removed: 0 });
    }
    const { codes, hashes } = newRecoveryCodes();
    tfSet(req.plexUser, { ...rec, pending: null, secret: rec.pending.secret, enabledAt: Date.now(), lastStep: step, recovery: hashes });
    sessions.update(req.plexSession, { verifiedAt: Date.now() }); // a good code was just entered
    // Other browsers signed in without the code; sign them out.
    const removed = sessions.revokeUser(req.plexUser, { except: req.plexSession });
    res.json({ ...summary(req), recoveryCodes: codes, removed });
  });
  account.post('/2fa/disable', (req, res) => {
    if (!enabled) return off(res);
    if (!tfOn(req.plexUser)) return res.status(400).json({ error: 'Two-factor is not on.' });
    const rec = confirmCode(req, res); if (!rec) return;
    // Turns off the authenticator app; with passkeys left, two-factor stays on.
    const keep = (rec.passkeys || []).length;
    tfSet(req.plexUser, keep ? { ...rec, secret: null, lastStep: null } : (rec.userHandle ? { userHandle: rec.userHandle } : null));
    res.json(summary(req));
  });
  account.post('/2fa/recovery', (req, res) => {
    if (!enabled) return off(res);
    if (!tfOn(req.plexUser)) return res.status(400).json({ error: 'Two-factor is not on.' });
    const rec = confirmCode(req, res); if (!rec) return;
    const { codes, hashes } = newRecoveryCodes();
    tfSet(req.plexUser, { ...rec, recovery: hashes });
    res.json({ ...summary(req), recoveryCodes: codes });
  });

  return {
    enabled, router, middleware, verify, roles, account, sessions,
    // For other routes that want "confirm it's you" first (see index.js).
    twoFactorOn: (user) => tfOn(user), recentlyVerified,
    getCookie: (req) => { const s = verify(getCookie(req, COOKIE)); return s ? s.username : null; },
    // Role for a request that passed the gate. Without Plex sign-in there is a
    // single operator (or Basic auth), so everyone is an admin.
    roleOf: (req) => (enabled ? (req.plexRole || null) : 'admin'),
    _sign: sign,
  };
}
