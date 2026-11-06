// Express glue for roles: the request guard and the Users & roles API.
import express from 'express';
import { permits, denialMessage, classifyAppRoute, classifyProxyRequest } from './roles.js';

export function createRoleGuard(plexAuth, { canSee = () => true, keyOf = (svc) => svc && svc.key } = {}) {
  const deny = (role, level, method) => ({ status: 403, error: denialMessage(role, level, method), role });

  // App routes (everything under /api except the proxy, which is checked
  // after its body is read so RPC method names can be inspected).
  function app(req, res, next) {
    const p = req.path;
    if (!p.startsWith('/api/') || p.startsWith('/api/auth/') || p.startsWith('/api/proxy/') || p.startsWith('/api/notify/action/')) return next();
    const role = plexAuth.roleOf(req);
    if (!role) return res.status(401).json({ error: 'Authentication required' });
    const level = classifyAppRoute(req.method, p);
    if (permits(role, level)) return next();
    const d = deny(role, level, req.method);
    return res.status(d.status).json({ error: d.error, role });
  }

  const hidden = (role, svc) => { const k = keyOf(svc); return k && !canSee(role, k) ? { status: 403, error: 'Your role can’t use this service', role } : null; };
  function proxy(req, svc, subPath) {
    const role = plexAuth.roleOf(req);
    if (!role) return { status: 401, error: 'Authentication required' };
    const h = hidden(role, svc); if (h) return h;
    const level = classifyProxyRequest(svc.type, req.method, subPath, req.query, req.body);
    return permits(role, level) ? null : deny(role, level, req.method);
  }

  // A server-side read on the caller's behalf (live updates): check the
  // underlying GET as if the caller had made it.
  function read(req, svc, path) {
    const role = plexAuth.roleOf(req);
    if (!role) return { status: 401, error: 'Authentication required' };
    const h = hidden(role, svc); if (h) return h;
    const [p, qs] = String(path).split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const level = classifyProxyRequest(svc.type, 'GET', p, query, null);
    return permits(role, level) ? null : deny(role, level, 'GET');
  }

  return { app, proxy, read };
}

// GET/POST/DELETE /api/users — admin only (enforced by the guard above).
export function mountUserRoutes(app, plexAuth, { plex, cfg }) {
  const json = express.json({ limit: '4kb' });
  const reply = (res, fn) => {
    try { res.json({ enabled: plexAuth.enabled, ...fn() }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
  app.get('/api/users', async (req, res) => {
    if (!plexAuth.enabled) return res.json({ enabled: false, users: [], me: null });
    // Suggestions: people on the Plex server (best effort; needs the token).
    let suggestions = [];
    try {
      const [users, friends] = await Promise.all([
        plex.getUsers(cfg).catch(() => []),
        plex.getFriends ? plex.getFriends(cfg).catch(() => []) : [],
      ]);
      suggestions = [...(users || []), ...(friends || [])]
        .map((u) => (u && (u.username || u.title || u.email)) || '')
        .filter(Boolean).slice(0, 200);
    } catch { /* ignore */ }
    reply(res, () => ({ ...plexAuth.roles.list(), me: req.plexUser || null, suggestions: [...new Set(suggestions)] }));
  });
  app.post('/api/users', json, (req, res) => {
    if (!plexAuth.enabled) return res.status(400).json({ error: 'Turn on Sign in with Plex to manage users' });
    const { id, role } = req.body || {};
    reply(res, () => plexAuth.roles.setUser(id, role, req.plexUser));
  });
  app.delete('/api/users/:id', (req, res) => {
    if (!plexAuth.enabled) return res.status(400).json({ error: 'Turn on Sign in with Plex to manage users' });
    reply(res, () => plexAuth.roles.removeUser(req.params.id, req.plexUser));
  });
}
