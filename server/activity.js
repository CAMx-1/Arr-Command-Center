// Activity log: who changed what. Records every request that isn't a plain
// read (anything the role rules class as write, delete or admin), after it
// finishes, with the user, role, service, a short description and the result.
// Request bodies, query strings and headers are never stored, except a few
// named, non-secret fields (an arr command's name, a Seerr request's media).
import { classifyProxyRequest, classifyAppRoute } from './roles.js';

export const ACTIVITY_CAP = 1000;
const LOGGED = new Set(['write', 'delete', 'admin']);

function jsonOf(body) {
  if (!body) return null;
  if (typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  try { return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); } catch { return null; }
}

const clean = (s) => String(s || '').replace(/[^\w\s.:/#()&'-]/g, '').slice(0, 80);
const VERB = { POST: 'added', PUT: 'changed', PATCH: 'changed', DELETE: 'deleted' };

// Plain description of a proxied request.
export function describeProxy(type, method, subPath, body) {
  const m = String(method).toUpperCase();
  const path = String(subPath || '').split('?')[0].replace(/^\/+/, '');
  const rest = path.replace(/^api\/v\d+\//, '').replace(/^api\//, '');
  const b = jsonOf(body) || {};
  if (/^command$/i.test(rest) && b.name) return `ran ${clean(b.name)}`;
  if (type === 'portainer') { const x = /containers\/([^/]+)\/(start|stop|restart)$/.exec(path); if (x) return `${x[2] === 'stop' ? 'stopped' : x[2] === 'start' ? 'started' : 'restarted'} container ${clean(x[1]).slice(0, 12)}`; }
  if (type === 'overseerr' && m === 'POST' && rest === 'request') return `requested ${b.mediaType === 'tv' ? 'show' : 'movie'} ${clean(b.mediaId)}`;
  if (type === 'overseerr') { const x = /^request\/(\d+)\/(approve|decline)$/.exec(rest); if (x) return `${x[2] === 'approve' ? 'approved' : 'declined'} request ${x[1]}`; }
  if (type === 'transmission' || type === 'deluge' || type === 'nzbget') { const name = b.method || (Array.isArray(b) && b[0] && b[0].method); if (name) return `called ${clean(name)}`; }
  if (type === 'qbittorrent') { const x = /^api\/v2\/torrents\/([a-z]+)/i.exec(path); if (x) return `torrents ${clean(x[1])}`; }
  const resource = rest.split('/').filter((p) => p && !/^\d+$/.test(p)).slice(0, 2).join(' ') || path || 'item';
  const id = (/\/(\d+)(\/|$)/.exec(`/${rest}`) || [])[1];
  return `${VERB[m] || m.toLowerCase()} ${clean(resource)}${id ? ` #${id}` : ''}`;
}

const APP_ROUTES = [
  [/^\/api\/config\/service\/[^/]+$/, 'DELETE', 'removed a service'],
  [/^\/api\/config\/service/, '', 'changed service settings'],
  [/^\/api\/users/, '', 'changed user roles'],
  [/^\/api\/notify\/channels/, '', 'changed notification channels'],
  [/^\/api\/automation\/config/, '', 'changed automation settings'],
  [/^\/api\/automation\/queue-cleaner\/run/, '', 'ran the queue cleaner'],
  [/^\/api\/automation\/hunt\/run/, '', 'ran a hunt'],
  [/^\/api\/push\/prefs/, '', 'changed push settings'],
  [/^\/api\/links/, '', 'changed custom links'],
  [/^\/api\/digest/, '', 'changed or sent the digest'],
  [/^\/api\/bot/, '', 'changed chat bot settings'],
  [/^\/api\/webhooks\/[^/]+\/install/, '', 'added a webhook to an app'],
  [/^\/api\/indexer\/[^/]+\/send/, '', 'sent an indexer result to an app'],
  [/^\/api\/plex\/scan/, '', 'started a Plex library scan'],
  [/^\/api\/media\/[^/]+\/match\//, '', 'fixed a Jellyfin/Emby match'],
  [/^\/api\/plex\/library\/[^/]+\/scan$/, '', 'scanned a Plex library'],
  [/^\/api\/plex\/library\/[^/]+\/refresh$/, '', 'refreshed a Plex library’s details'],
  [/^\/api\/plex\/library\/[^/]+\/emptyTrash$/, '', 'emptied a Plex library’s trash'],
  [/^\/api\/plex\/shares$/, 'POST', 'shared the Plex server with someone'],
  [/^\/api\/plex\/shares\/[^/]+$/, 'PUT', 'changed which Plex libraries someone has'],
  [/^\/api\/plex\/shares\/[^/]+$/, 'DELETE', 'stopped sharing the Plex server with someone'],
  [/^\/api\/self-backup\/export/, '', 'made a backup of Arr Command Center'],
  [/^\/api\/self-backup\/preview/, '', 'opened a backup of Arr Command Center'],
  [/^\/api\/self-backup\/restore/, '', 'restored a backup of Arr Command Center'],
  [/^\/api\/account\/2fa\/confirm/, '', 'turned on two-factor sign-in'],
  [/^\/api\/account\/2fa\/disable/, '', 'turned off two-factor sign-in'],
  [/^\/api\/account\/sessions/, '', 'signed out a session'],
  [/^\/api\/webhooks\/[^/]+\/rotate/, '', 'changed a webhook address'],
  [/^\/api\/activity/, 'DELETE', 'cleared the activity log'],
];
export function describeApp(method, path) {
  for (const [re, m, text] of APP_ROUTES) if (re.test(path) && (!m || m === String(method).toUpperCase())) return text;
  return `${String(method).toLowerCase()} ${clean(path.replace(/^\/api\//, ''))}`;
}

export function createActivityLog({ store, cfg, roleOf = () => 'admin', now = () => Date.now() }) {
  const record = (entry) => store.push('activity', { at: new Date(now()).toISOString(), ...entry }, ACTIVITY_CAP);

  function middleware(req, res, next) {
    const m = req.method.toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
    const p = req.path;
    if (!p.startsWith('/api/') || p.startsWith('/api/auth/') || p.startsWith('/api/live')) return next();
    res.on('finish', () => {
      // "Confirm it's you" prompts aren't refusals; the retry is what counts.
      if (res.locals && res.locals.needsVerification) return;
      try {
        const role = roleOf(req) || 'none';
        const user = req.plexUser || (role === 'admin' && !req.plexRole ? 'admin' : 'unknown');
        const px = /^\/api\/proxy\/([^/]+)\/?(.*)$/.exec(p);
        if (px) {
          const key = decodeURIComponent(px[1]);
          const svc = (cfg.services || {})[key];
          if (!svc) return;
          const level = classifyProxyRequest(svc.type, m, px[2], req.query, req.body);
          if (!LOGGED.has(level)) return;
          record({ user, role, service: key, serviceLabel: svc.label || key, method: m, level, action: describeProxy(svc.type, m, px[2], req.body), status: res.statusCode });
          return;
        }
        const level = classifyAppRoute(m, p);
        if (!LOGGED.has(level)) return;
        record({ user, role, service: '', serviceLabel: 'Arr Command Center', method: m, level, action: describeApp(m, p), status: res.statusCode });
      } catch { /* never break a request over logging */ }
    });
    next();
  }

  return {
    middleware,
    record,
    list: ({ user, service, q, limit = 500 } = {}) => store.get('activity', [])
      .filter((e) => (!user || e.user === user) && (!service || e.service === service) && (!q || `${e.action} ${e.serviceLabel} ${e.user}`.toLowerCase().includes(String(q).toLowerCase())))
      .slice(0, Math.min(ACTIVITY_CAP, Number(limit) || 500)),
    clear: () => store.set('activity', []),
  };
}
