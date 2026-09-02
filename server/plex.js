// Plex API helpers. Uses a Plex token captured at login (stored server-side) or
// cfg.plex.token. The token never reaches the browser — the frontend calls the
// /api/plex/* routes which use these.
import * as store from './store.js';

const PROVIDER = 'https://metadata.provider.plex.tv';
const PLEX_TV = 'https://plex.tv';

// Build a same-origin proxied image URL (token added server-side by /api/plex/image).
function imgProxy(fullUrl) { return fullUrl ? `/api/plex/image?u=${encodeURIComponent(fullUrl)}` : null; }
export function providerImage(thumb) { return thumb ? imgProxy(thumb.startsWith('http') ? thumb : PROVIDER + thumb) : null; }
export function serverImage(cfg, thumb) {
  const url = plexServerUrl(cfg);
  if (!thumb || !url) return null;
  return imgProxy(thumb.startsWith('http') ? thumb : url.replace(/\/$/, '') + thumb);
}

export function plexToken(cfg) {
  const svc = plexService(cfg);
  return svc.apiKey || (cfg.plex && cfg.plex.token) || (store.get('plex', {}) || {}).token || null;
}
// The Plex service can be configured either as a top-level cfg.plex block or as a
// service entry (type: 'plex') whose apiKey = token and baseUrl = PMS URL.
function plexService(cfg) {
  const s = cfg.services || {};
  return s.plex || Object.values(s).find((x) => x && x.type === 'plex') || {};
}
export function plexServerUrl(cfg) {
  const svc = plexService(cfg);
  return svc.baseUrl || (cfg.plex && cfg.plex.serverUrl) || null;
}
function clientId(cfg) {
  return (cfg.plex && cfg.plex.clientId) || (cfg.auth && cfg.auth.plex && cfg.auth.plex.clientId) || 'arr-command-center';
}
async function pj(url, token, cid) {
  const r = await fetch(url, { headers: { 'X-Plex-Token': token, 'X-Plex-Client-Identifier': cid, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Plex HTTP ${r.status}`);
  return r.json();
}

export function hasToken(cfg) { return !!plexToken(cfg); }

// Decide whether an image URL may be proxied with the Plex token. Prevents SSRF /
// token exfiltration: we parse the URL, reject any embedded credentials
// (userinfo like http://host@evil.com), and require either a Plex-owned host or
// an exact origin match (protocol+host+port) with the configured server — NOT a
// string prefix, which `http://server@evil.com` or `http://server.evil.com` beat.
export function isAllowedImageUrl(u, serverUrl) {
  let target;
  try { target = new URL(u); } catch { return false; }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  if (target.username || target.password) return false; // no userinfo tricks
  const host = target.hostname;
  const plexOwned = host === 'metadata.provider.plex.tv'
    || host === 'discover.provider.plex.tv'
    || /(^|\.)plex\.tv$/.test(host)
    || /(^|\.)plex\.direct$/.test(host);
  if (plexOwned) return true;
  if (serverUrl) {
    try {
      const s = new URL(serverUrl);
      if (target.protocol === s.protocol && target.hostname === s.hostname && target.port === s.port) return true;
    } catch { /* invalid configured serverUrl */ }
  }
  return false;
}

// Parse a Plex library "duplicate" Metadata item into { title, year, type,
// section, parts:[{file,size}] }. Exported for testing. A Plex duplicate has
// more than one Media/Part (the same movie/episode present as multiple files).
export function parseDuplicateItem(m, section) {
  const parts = [];
  for (const media of (m.Media || [])) {
    for (const p of (media.Part || [])) {
      if (p && p.file) parts.push({ file: p.file, size: Number(p.size) || 0 });
    }
  }
  return { title: m.title, year: m.year, type: m.type, section, ratingKey: m.ratingKey, parts };
}

// Ask the Plex server for duplicates across all movie/show libraries. Works even
// when Radarr/Sonarr paths are broken, because Plex scanned the real disk.
export async function getDuplicates(cfg) {
  const t = plexToken(cfg);
  const url = plexServerUrl(cfg);
  if (!t) throw new Error('No Plex token — sign in with Plex first');
  if (!url) throw new Error('Set the Plex server URL (services.plex.baseUrl) to scan for duplicates');
  const base = url.replace(/\/$/, '');
  const cid = clientId(cfg);
  const sects = await pj(`${base}/library/sections`, t, cid);
  const dirs = (sects.MediaContainer && sects.MediaContainer.Directory) || [];
  const out = [];
  for (const d of dirs) {
    if (!['movie', 'show'].includes(d.type)) continue;
    try {
      const data = await pj(`${base}/library/sections/${d.key}/all?duplicate=1`, t, cid);
      const md = (data.MediaContainer && data.MediaContainer.Metadata) || [];
      for (const m of md) {
        const item = parseDuplicateItem(m, d.title);
        if (item.parts.length > 1) out.push(item);
      }
    } catch { /* skip a section that errors */ }
  }
  return out;
}

export async function getWatchlist(cfg) {
  const t = plexToken(cfg);
  if (!t) throw new Error('No Plex token — sign in with Plex first');
  const bases = ['https://discover.provider.plex.tv', 'https://metadata.provider.plex.tv'];
  const qs = 'X-Plex-Container-Start=0&X-Plex-Container-Size=100&includeExternalMedia=1';
  let lastErr;
  for (const base of bases) {
    try {
      const d = await pj(`${base}/library/sections/watchlist/all?${qs}`, t, clientId(cfg));
      const items = (d.MediaContainer && d.MediaContainer.Metadata) || [];
      return items.map((m) => ({
        title: m.title, type: m.type, year: m.year, ratingKey: m.ratingKey, guid: m.guid, addedAt: m.addedAt,
        image: providerImage(m.thumb),
        tmdbId: extractGuid(m, 'tmdb'),
      }));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Watchlist unavailable');
}

export async function getUsers(cfg) {
  const t = plexToken(cfg);
  if (!t) throw new Error('No Plex token — sign in with Plex first');
  const d = await pj(`${PLEX_TV}/api/v2/home/users`, t, clientId(cfg)).catch(() => null);
  let users = [];
  if (d && Array.isArray(d.users)) users = d.users;
  else if (d && Array.isArray(d)) users = d;
  else if (d && d.MediaContainer && d.MediaContainer.User) users = d.MediaContainer.User;
  return users.map((u) => ({
    id: u.id || u.uuid, title: u.title || u.friendlyName || u.username || 'User',
    email: u.email || '', admin: !!u.admin, restricted: !!u.restricted, protected: !!u.protected, thumb: u.thumb || '',
  }));
}

export async function getFriends(cfg) {
  const t = plexToken(cfg);
  if (!t) throw new Error('No Plex token — sign in with Plex first');
  // Plex retired /api/v2/friends (HTTP 410); the shared-users list is XML at /api/users.
  const r = await fetch(`${PLEX_TV}/api/users`, { headers: { 'X-Plex-Token': t, 'X-Plex-Client-Identifier': clientId(cfg) } });
  if (!r.ok) throw new Error(`Plex HTTP ${r.status}`);
  const xml = await r.text();
  const attr = (tag, name) => { const m = tag.match(new RegExp(`${name}="([^"]*)"`)); return m ? m[1] : ''; };
  const users = xml.match(/<User\b[^>]*>/g) || [];
  return users.map((u) => ({
    id: attr(u, 'id'),
    title: attr(u, 'title') || attr(u, 'username') || 'Friend',
    username: attr(u, 'username'),
    email: attr(u, 'email'),
    thumb: attr(u, 'thumb') ? imgProxy(attr(u, 'thumb')) : '',
    home: attr(u, 'home') === '1',
    restricted: attr(u, 'restricted') === '1',
  }));
}

export async function getSessions(cfg) {
  const t = plexToken(cfg);
  const url = plexServerUrl(cfg);
  if (!t || !url) return [];
  const d = await pj(`${url.replace(/\/$/, '')}/status/sessions`, t, clientId(cfg));
  const s = (d.MediaContainer && d.MediaContainer.Metadata) || [];
  return s.map((x) => ({
    title: x.grandparentTitle ? `${x.grandparentTitle} — ${x.title}` : `${x.title}${x.year ? ` (${x.year})` : ''}`,
    user: x.User && x.User.title, player: x.Player && x.Player.title,
    state: x.Player && x.Player.state, progress: x.viewOffset && x.duration ? Math.round((x.viewOffset / x.duration) * 100) : 0,
    image: serverImage(cfg, x.grandparentThumb || x.thumb),
  }));
}

// Pull a service id (tmdb/imdb/tvdb) out of a Plex metadata item's Guid array.
function extractGuid(m, service) {
  const arr = Array.isArray(m.Guid) ? m.Guid : [];
  for (const g of arr) {
    const id = typeof g === 'string' ? g : g.id;
    const mm = new RegExp(`^${service}://(.+)$`).exec(String(id || ''));
    if (mm) return mm[1].split('?')[0];
  }
  return null;
}
