// Optional "Sign in with Plex" gate for the whole dashboard.
// Uses Plex's OAuth PIN flow entirely server-side, so the Plex auth token never
// touches the browser. On success the browser receives a signed, HttpOnly session
// cookie. Access can be restricted to an allowlist of Plex usernames/emails.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';

const PLEX_API = 'https://plex.tv/api/v2';
const COOKIE = 'acc_session';

// Persist a stable client identifier + session secret across restarts.
function loadState(root) {
  const file = path.join(root, '.auth-state.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const state = { clientId: crypto.randomUUID(), sessionSecret: crypto.randomBytes(32).toString('hex') };
    try { fs.writeFileSync(file, JSON.stringify(state, null, 2)); } catch { /* best effort */ }
    return state;
  }
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

export function createPlexAuth(cfg, { root, publicDir }) {
  const pcfg = (cfg.auth && cfg.auth.plex) || {};
  const enabled = !!pcfg.enabled;
  const product = pcfg.product || 'Arr Command Center';
  const allowed = (pcfg.allowedUsers || []).map((u) => String(u).toLowerCase().trim()).filter(Boolean);
  const ttlSeconds = (pcfg.sessionDays || 30) * 86400;
  const secureCookies = !!pcfg.secureCookies || process.env.SECURE_COOKIES === 'true';
  const allowAny = !!pcfg.allowAnyPlexUser || process.env.PLEX_ALLOW_ANY === 'true';

  // Fail-closed by default: an empty allowlist denies all logins unless the
  // operator explicitly opts into open access.
  if (enabled && !allowed.length && !allowAny) {
    console.warn('[auth] Plex auth is ENABLED but the allowlist is EMPTY and allowAnyPlexUser is false — all logins will be DENIED. Add auth.plex.allowedUsers, or set auth.plex.allowAnyPlexUser: true to allow any Plex account.');
  } else if (enabled && allowAny && !allowed.length) {
    console.warn('[auth] Plex auth is ENABLED with allowAnyPlexUser=true — ANY Plex account can sign in. Set auth.plex.allowedUsers to restrict access.');
  }

  const state = loadState(root);
  const clientId = pcfg.clientId || state.clientId;
  const secret = process.env.SESSION_SECRET || pcfg.sessionSecret || state.sessionSecret;

  function sign(username) {
    const payload = Buffer.from(JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
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
      const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (!exp || exp < Math.floor(Date.now() / 1000)) return null;
      return u;
    } catch { return null; }
  }

  function sessionCookie(value, maxAge) {
    const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (secureCookies) parts.push('Secure');
    parts.push(`Max-Age=${maxAge}`);
    return parts.join('; ');
  }

  function isAllowed(user) {
    if (!allowed.length) return allowAny; // empty allowlist: fail closed unless allowAnyPlexUser
    const uname = String(user.username || '').toLowerCase();
    const email = String(user.email || '').toLowerCase();
    return allowed.includes(uname) || allowed.includes(email);
  }

  // ---- Router: /api/auth/* ----
  const router = express.Router();
  router.use(express.json());

  router.get('/me', (req, res) => {
    res.json({ enabled, user: enabled ? (verify(getCookie(req, COOKIE)) || null) : null });
  });

  router.post('/plex/pin', async (req, res) => {
    if (!enabled) return res.status(400).json({ error: 'Plex auth is disabled' });
    try {
      const r = await fetch(`${PLEX_API}/pins?strong=true`, { method: 'POST', headers: plexHeaders(clientId, product) });
      const data = await r.json();
      if (!data || !data.id) return res.status(502).json({ error: 'Could not create Plex PIN' });
      const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}&code=${encodeURIComponent(data.code)}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(product)}`;
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
      // Capture the Plex token server-side (never sent to the browser) so the
      // dashboard can call the Plex API (watchlist, users, sessions). Also log
      // the successful login.
      const uname = user.username || user.email;
      try { store.set('plex', { token: data.authToken, user: uname, at: Date.now() }); } catch { /* best effort */ }
      try {
        store.push('loginLog', {
          user: uname, at: Date.now(),
          ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '',
          ua: req.headers['user-agent'] || '',
        });
      } catch { /* best effort */ }
      res.setHeader('Set-Cookie', sessionCookie(sign(uname), ttlSeconds));
      res.json({ authorized: true, user: { username: user.username, email: user.email, thumb: user.thumb } });
    } catch (e) {
      res.status(502).json({ authorized: false, error: 'Plex request failed: ' + e.message });
    }
  });

  router.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ ok: true });
  });

  // ---- Gate middleware ----
  const ALLOW_UNAUTH = new Set(['/login.html', '/login.js', '/login.css', '/styles.css', '/favicon.ico']);
  function middleware(req, res, next) {
    if (!enabled) return next();
    const p = req.path;
    if (p.startsWith('/api/auth/')) return next();
    if (ALLOW_UNAUTH.has(p) || p.startsWith('/icons/')) return next();

    const user = verify(getCookie(req, COOKIE));
    if (user) { req.plexUser = user; return next(); }
    if (p.startsWith('/api/')) return res.status(401).json({ error: 'Authentication required' });
    return res.sendFile(path.join(publicDir, 'login.html'));
  }

  return { enabled, router, middleware, verify, getCookie: (req) => verify(getCookie(req, COOKIE)) };
}
