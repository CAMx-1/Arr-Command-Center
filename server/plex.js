// Plex API helpers. Uses a Plex token captured at login (stored server-side) or
// cfg.plex.token. The token never reaches the browser — the frontend calls the
// /api/plex/* routes which use these.
import * as store from './store.js';

// Plex-token-bearing requests never follow redirects (see proxy.js).
const fetch = (url, init = {}) => globalThis.fetch(url, { redirect: 'manual', ...init });


const PROVIDER = 'https://metadata.provider.plex.tv';
const PLEX_TV = 'https://plex.tv';
// cfg.plexTvBase points the demo at its plex.tv mock; real setups use plex.tv.
const tvBase = (cfg) => String((cfg && cfg.plexTvBase) || PLEX_TV).replace(/\/+$/, '');

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
// section, parts:[{file,size}] } (episodes also get show, season, episode).
// Exported for testing. A Plex duplicate has more than one Media/Part (the
// same movie/episode present as multiple files).
export function parseDuplicateItem(m, section) {
  const parts = [];
  for (const media of (m.Media || [])) {
    for (const p of (media.Part || [])) {
      if (p && p.file) parts.push({ file: p.file, size: Number(p.size) || 0 });
    }
  }
  const out = { title: m.title, year: m.year, type: m.type, section, ratingKey: m.ratingKey, parts };
  if (m.type === 'episode') {
    out.show = m.grandparentTitle || null;
    out.season = m.parentIndex != null ? Number(m.parentIndex) : null;
    out.episode = m.index != null ? Number(m.index) : null;
  }
  return out;
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
      // A TV library lists shows unless asked for episodes (type=4), and an
      // episode is what has two files.
      const data = await pj(`${base}/library/sections/${d.key}/all?${d.type === 'show' ? 'type=4&' : ''}duplicate=1`, t, cid);
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
  const d = await pj(`${tvBase(cfg)}/api/v2/home/users`, t, clientId(cfg)).catch(() => null);
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
  const r = await fetch(`${tvBase(cfg)}/api/users`, { headers: { 'X-Plex-Token': t, 'X-Plex-Client-Identifier': clientId(cfg) } });
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

// ------------------------------------------------------- wrong-match check
const folderName = (p) => normPath(p).split('/').pop();
// Plex items whose TMDB/TVDB id doesn't match the Sonarr/Radarr entry stored
// in the same folder. Matching is by folder, so titles don't have to agree.
// Plex and the apps often see the same disks under different mount points
// (Docker), so when the full path isn't found the folder's own name is used,
// as long as only one Sonarr/Radarr entry has that name.
// Returns { items, compared } (compared: Plex titles paired with an entry).
const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const parentDir = (p) => normPath(p).replace(/\/[^/]*$/, '');
export function plexIds(item) {
  const out = {};
  for (const g of item.Guid || []) { const m = /^(tmdb|tvdb|imdb):\/\/(.+)$/.exec(g.id || ''); if (m) out[m[1]] = m[2]; }
  return out;
}
// Plex: TMDB for movies, TVDB for shows. opts.pickId(type, ids, arrItem)
// returns { key, want } to compare, or null to skip (used for Jellyfin/Emby).
const plexPick = (type, ids, a) => ({ key: type === 'show' ? 'tvdb' : 'tmdb', want: String(type === 'show' ? a.tvdbId : a.tmdbId || '') });
export function findWrongMatches(plexItems, arrItems, { pickId = plexPick } = {}) {
  const byFolder = new Map(arrItems.map((a) => [normPath(a.path), a]));
  const byName = new Map();
  for (const a of arrItems) { const n = folderName(a.path); if (n) byName.set(n, byName.has(n) ? null : a); }
  const out = []; let compared = 0;
  for (const p of plexItems) {
    const folder = p.type === 'show' ? normPath((p.Location || [])[0] && p.Location[0].path) : parentDir(((p.Media || [])[0] && p.Media[0].Part && p.Media[0].Part[0] && p.Media[0].Part[0].file) || '');
    const a = folder ? (byFolder.get(folder) || byName.get(folderName(folder)) || null) : null;
    if (!a) continue;
    const ids = plexIds(p);
    const pick = pickId(p.type, ids, a);
    if (!pick) continue;
    const { key, want } = pick;
    if (!want || want === 'undefined' || want === 'null') continue;
    compared += 1;
    if (ids[key] === want) continue;
    out.push({ ratingKey: p.ratingKey, type: p.type, plexTitle: p.title, plexYear: p.year, plexId: ids[key] || null, idType: key,
      arr: { serviceKey: a.serviceKey, serviceLabel: a.serviceLabel, id: a.id, title: a.title, year: a.year, expectedId: want }, folder: a.path || folder });
  }
  return { items: out, compared };
}

async function plexBase(cfg) {
  const t = plexToken(cfg); const url = plexServerUrl(cfg);
  if (!t) throw new Error('No Plex token — sign in with Plex first');
  if (!url) throw new Error('Set the Plex server URL (services.plex.baseUrl)');
  return { t, base: url.replace(/\/$/, ''), cid: clientId(cfg) };
}
export async function plexLibraryItems(cfg) {
  const { t, base, cid } = await plexBase(cfg);
  const sects = await pj(`${base}/library/sections`, t, cid);
  const out = [];
  for (const d of (sects.MediaContainer && sects.MediaContainer.Directory) || []) {
    if (!['movie', 'show'].includes(d.type)) continue;
    const data = await pj(`${base}/library/sections/${encodeURIComponent(d.key)}/all?includeGuids=1`, t, cid).catch(() => null);
    out.push(...(((data && data.MediaContainer && data.MediaContainer.Metadata) || []).map((m) => ({ ...m, section: d.title, sectionKey: String(d.key) }))));
  }
  return out;
}
export async function plexMatchCandidates(cfg, ratingKey, { title, year } = {}) {
  const { t, base, cid } = await plexBase(cfg);
  const qs = new URLSearchParams({ manual: '1', ...(title ? { title } : {}), ...(year ? { year: String(year) } : {}) });
  const d = await pj(`${base}/library/metadata/${encodeURIComponent(ratingKey)}/matches?${qs}`, t, cid);
  return ((d.MediaContainer && d.MediaContainer.SearchResult) || []).map((r) => ({ guid: r.guid, name: r.name, year: r.year, score: r.score }));
}
export async function plexApplyMatch(cfg, ratingKey, { guid, name, year }) {
  const { t, base, cid } = await plexBase(cfg);
  if (!/^[a-z]+:\/\/[\w./:-]+$/i.test(String(guid || ''))) throw new Error('Bad match id');
  const qs = new URLSearchParams({ guid, ...(name ? { name } : {}), ...(year ? { year: String(year) } : {}) });
  const r = await fetch(`${base}/library/metadata/${encodeURIComponent(ratingKey)}/match?${qs}`, { method: 'PUT', headers: { 'X-Plex-Token': t, 'X-Plex-Client-Identifier': cid } });
  if (!r.ok) throw new Error(`Plex HTTP ${r.status}`);
  await fetch(`${base}/library/metadata/${encodeURIComponent(ratingKey)}/refresh`, { method: 'PUT', headers: { 'X-Plex-Token': t, 'X-Plex-Client-Identifier': cid } }).catch(() => {});
}

// ------------------------------------------------------- missing from Plex
// Titles Sonarr/Radarr have files for that Plex doesn't show, and shows where
// Plex has fewer episodes than Sonarr has files. Plex is checked by folder
// (any file's folder for movies, any location for shows), then by folder
// name when Plex sees the disks at another mount point, then by TMDB/TVDB id.
const sepOf = (p) => (String(p).includes('\\') && !String(p).includes('/') ? '\\' : '/');
const lastSeg = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
const parentRaw = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
function plexFolders(p) {
  if (p.type === 'show') return (p.Location || []).map((l) => l.path).filter(Boolean);
  return [...new Set((p.Media || []).flatMap((m) => (m.Part || []).map((x) => parentRaw(x.file))).filter(Boolean))];
}

// Where Plex sees an app's folder: the Plex parent folder of another title
// from the same root folder, or the root folder itself when a Plex library
// uses it. null when it can't be worked out (then the whole library is scanned).
export function plexPathFor(arrItem, pairs, sections) {
  const root = normPath(arrItem.rootFolderPath || parentRaw(arrItem.path));
  const name = lastSeg(arrItem.path);
  const pair = pairs.find((x) => normPath(parentRaw(x.arrPath)) === root);
  if (pair) { const parent = parentRaw(pair.plexPath); return `${parent}${sepOf(pair.plexPath)}${name}`; }
  for (const sct of sections || []) for (const l of sct.Location || []) if (normPath(l.path) === root) return `${String(l.path).replace(/[\\/]+$/, '')}${sepOf(l.path)}${name}`;
  return null;
}
export function sectionFor(plexPath, sections, kind) {
  const want = kind === 'movie' ? 'movie' : 'show';
  const typed = (sections || []).filter((x) => x.type === want);
  const n = plexPath ? normPath(plexPath) : '';
  return (n && typed.find((x) => (x.Location || []).some((l) => n.startsWith(`${normPath(l.path)}/`)))) || typed[0] || null;
}

// arrItems: { kind: 'movie'|'show', serviceKey, serviceLabel, id, title, year, path, rootFolderPath, tmdbId, tvdbId, files, added }
export function findMissingInPlex(plexItems, arrItems, sections = []) {
  const byPath = new Map(); const byName = new Map(); const byId = new Map();
  for (const p of plexItems) {
    const kind = p.type === 'show' ? 'show' : 'movie';
    for (const f of plexFolders(p)) {
      byPath.set(`${kind}:${normPath(f)}`, { p, f });
      const k = `${kind}:${folderName(f)}`; byName.set(k, byName.has(k) ? null : { p, f });
    }
    const ids = plexIds(p);
    if (kind === 'movie' && ids.tmdb) byId.set(`movie:tmdb:${ids.tmdb}`, { p, f: plexFolders(p)[0] });
    if (kind === 'show' && ids.tvdb) byId.set(`show:tvdb:${ids.tvdb}`, { p, f: plexFolders(p)[0] });
  }
  const pairs = []; const missing = []; const episodes = []; let compared = 0;
  for (const a of arrItems) {
    if (!(a.files > 0)) continue;
    compared += 1;
    const hit = byPath.get(`${a.kind}:${normPath(a.path)}`) || byName.get(`${a.kind}:${folderName(a.path)}`)
      || byId.get(a.kind === 'movie' ? `movie:tmdb:${a.tmdbId}` : `show:tvdb:${a.tvdbId}`) || null;
    if (hit && hit.f && folderName(hit.f) === folderName(a.path)) pairs.push({ arrPath: a.path, plexPath: hit.f });
    if (!hit) { missing.push(a); continue; }
    if (a.kind === 'show' && Number(hit.p.leafCount) < a.files) episodes.push({ ...a, plexEpisodes: Number(hit.p.leafCount) || 0, ratingKey: hit.p.ratingKey, plexFolder: hit.f });
  }
  const withScan = (a, plexPath) => { const sct = sectionFor(plexPath, sections, a.kind); return { ...a, plexPath, sectionKey: sct ? String(sct.key) : null, sectionTitle: sct ? sct.title : null }; };
  return {
    compared,
    missing: missing.map((a) => withScan(a, plexPathFor(a, pairs, sections))),
    episodes: episodes.map((a) => withScan(a, a.plexFolder)),
  };
}

export async function plexSections(cfg) {
  const { t, base, cid } = await plexBase(cfg);
  const d = await pj(`${base}/library/sections`, t, cid);
  return ((d.MediaContainer && d.MediaContainer.Directory) || []).map((x) => ({ key: String(x.key), type: x.type, title: x.title, Location: x.Location || [], scannedAt: x.scannedAt || null, refreshing: !!x.refreshing }));
}

// Scan one folder of a library (Plex's partial scan), or the whole library.
export async function plexScan(cfg, sectionKey, path) {
  const { t, base, cid } = await plexBase(cfg);
  if (!/^\d{1,9}$/.test(String(sectionKey))) throw new Error('Bad library');
  if (path != null && (typeof path !== 'string' || !path || path.length > 1024 || /[\0\r\n]/.test(path))) throw new Error('Bad folder');
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  const r = await fetch(`${base}/library/sections/${sectionKey}/refresh${qs}`, { headers: { 'X-Plex-Token': t, 'X-Plex-Client-Identifier': cid } });
  if (!r.ok) throw new Error(`Plex HTTP ${r.status}`);
}

// ------------------------------------------------------- server and sharing
// Library maintenance on the server, and who it's shared with. plex.tv's
// sharing API (the same calls python-plexapi makes) answers in XML.
const decodeXml = (v) => v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
export function xmlAttrs(tag) { const o = {}; for (const m of String(tag).matchAll(/([\w:.-]+)="([^"]*)"/g)) o[m[1]] = decodeXml(m[2]); return o; }
// Elements called `name` (not nested in themselves), with attributes and inner XML.
export function xmlElements(xml, name) {
  const re = new RegExp(`<${name}\\b((?:[^>"]|"[^"]*")*?)(/>|>([\\s\\S]*?)</${name}>)`, 'g');
  return [...String(xml || '').matchAll(re)].map((m) => ({ attrs: xmlAttrs(m[1]), inner: m[3] || '' }));
}

async function tvXml(cfg, path, { method = 'GET', body } = {}) {
  const t = plexToken(cfg);
  if (!t) throw new Error('No Plex token — sign in with Plex first');
  const r = await fetch(`${tvBase(cfg)}${path}`, { method, headers: { 'X-Plex-Token': t, 'X-Plex-Client-Identifier': clientId(cfg), Accept: 'application/xml', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('plex.tv refused this Plex token. Sharing can only be managed with the server owner’s token.'), { status: 403 });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    const msg = (/<error[^>]*>([^<]+)</i.exec(text) || /"error"\s*:\s*"([^"]+)"/.exec(text) || [])[1];
    throw Object.assign(new Error(msg ? `plex.tv: ${decodeXml(msg)}` : `plex.tv HTTP ${r.status}`), { status: r.status >= 500 ? 502 : r.status });
  }
  return r.text();
}

export async function plexServerInfo(cfg) {
  const { t, base, cid } = await plexBase(cfg);
  const [root, sections] = await Promise.all([pj(`${base}/`, t, cid), plexSections(cfg)]);
  const mc = root.MediaContainer || {};
  const libraries = await Promise.all(sections.map(async (x) => {
    const d = await pj(`${base}/library/sections/${encodeURIComponent(x.key)}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`, t, cid).catch(() => null);
    const c = d && d.MediaContainer;
    return { key: x.key, title: x.title, type: x.type, scannedAt: Number(x.scannedAt) || null, refreshing: !!x.refreshing, count: c ? Number(c.totalSize ?? c.size) : null };
  }));
  return { name: mc.friendlyName || 'Plex', version: mc.version || null, platform: [mc.platform, mc.platformVersion].filter(Boolean).join(' ') || null, machineIdentifier: mc.machineIdentifier || null, libraries };
}

// scan: look for new and removed files. refresh: download details and art
// again for everything. emptyTrash: forget items whose files are gone.
const LIB_ACTIONS = {
  scan: ['GET', (k) => `/library/sections/${k}/refresh`],
  refresh: ['GET', (k) => `/library/sections/${k}/refresh?force=1`],
  emptyTrash: ['PUT', (k) => `/library/sections/${k}/emptyTrash`],
};
export async function plexLibraryAction(cfg, sectionKey, action) {
  const a = LIB_ACTIONS[action];
  if (!a) throw Object.assign(new Error('Unknown action'), { status: 400 });
  if (!/^\d{1,9}$/.test(String(sectionKey))) throw Object.assign(new Error('Bad library'), { status: 400 });
  const { t, base, cid } = await plexBase(cfg);
  const r = await fetch(`${base}${a[1](sectionKey)}`, { method: a[0], headers: { 'X-Plex-Token': t, 'X-Plex-Client-Identifier': cid } });
  if (!r.ok) throw new Error(`Plex HTTP ${r.status}`);
}

async function machineIdOf(cfg) {
  const { t, base, cid } = await plexBase(cfg);
  const d = await pj(`${base}/identity`, t, cid);
  const id = d && d.MediaContainer && d.MediaContainer.machineIdentifier;
  if (!id) throw new Error('Plex didn’t say which server this is');
  return id;
}
// This server's libraries as plex.tv numbers them (sharing uses these ids).
async function tvLibraries(cfg, machineId) {
  const xml = await tvXml(cfg, `/api/servers/${encodeURIComponent(machineId)}`);
  return xmlElements(xml, 'Section').map(({ attrs: a }) => ({ id: String(a.id), key: String(a.key), title: a.title, type: a.type }));
}

export async function plexShares(cfg) {
  const machineId = await machineIdOf(cfg);
  const [libraries, usersXml] = await Promise.all([tvLibraries(cfg, machineId), tvXml(cfg, '/api/users')]);
  const users = xmlElements(usersXml, 'User').map(({ attrs: u, inner }) => {
    const srv = xmlElements(inner, 'Server').map((x) => x.attrs).find((x) => x.machineIdentifier === machineId) || null;
    return {
      userId: u.id, title: u.title || u.username || u.email || 'User', username: u.username || '', email: u.email || '', home: u.home === '1', managed: u.restricted === '1',
      shareId: srv ? String(srv.id) : null, allLibraries: !!srv && srv.allLibraries === '1', pending: !!srv && srv.pending === '1', libraries: [],
    };
  });
  await Promise.all(users.filter((u) => u.shareId).map(async (u) => {
    const xml = await tvXml(cfg, `/api/servers/${encodeURIComponent(machineId)}/shared_servers/${encodeURIComponent(u.shareId)}`).catch(() => null);
    u.libraries = xml ? xmlElements(xml, 'Section').filter((x) => x.attrs.shared === '1').map((x) => String(x.attrs.id)) : (u.allLibraries ? libraries.map((l) => l.id) : []);
  }));
  users.sort((a, b) => Number(!!b.shareId) - Number(!!a.shareId) || a.title.localeCompare(b.title));
  return { machineId, libraries, users };
}

const shareIdOk = (id) => { if (!/^\d{1,15}$/.test(String(id))) throw Object.assign(new Error('Bad share'), { status: 400 }); return String(id); };
async function checkedLibraries(cfg, machineId, wanted) {
  const known = new Set((await tvLibraries(cfg, machineId)).map((l) => l.id));
  const ids = [...new Set((Array.isArray(wanted) ? wanted : []).map(String))].filter((x) => known.has(x));
  if (!ids.length) throw Object.assign(new Error('Pick at least one library'), { status: 400 });
  return ids.map(Number);
}

// `who` (a Plex username or email) for someone new, or `userId` for a Plex
// friend or Home user who doesn't have this server yet.
export async function plexShareInvite(cfg, { who, userId, libraries, allowDownloads = false } = {}) {
  const invitee = String(who || '').trim();
  if (userId != null && !/^\d{1,15}$/.test(String(userId))) throw Object.assign(new Error('Bad user'), { status: 400 });
  if (userId == null && (!invitee || invitee.length > 200 || /[\s<>"]/.test(invitee))) throw Object.assign(new Error('Enter their Plex username or email'), { status: 400 });
  const machineId = await machineIdOf(cfg);
  const ids = await checkedLibraries(cfg, machineId, libraries);
  await tvXml(cfg, `/api/servers/${encodeURIComponent(machineId)}/shared_servers`, { method: 'POST', body: {
    server_id: machineId,
    shared_server: { library_section_ids: ids, ...(userId != null ? { invited_id: Number(userId) } : { invited_email: invitee }) },
    sharing_settings: { allowSync: allowDownloads ? '1' : '0', allowCameraUpload: '0', allowChannels: '0', filterMovies: '', filterTelevision: '', filterMusic: '' },
  } });
}

export async function plexShareUpdate(cfg, shareId, libraries) {
  const id = shareIdOk(shareId);
  const machineId = await machineIdOf(cfg);
  const ids = await checkedLibraries(cfg, machineId, libraries);
  await tvXml(cfg, `/api/servers/${encodeURIComponent(machineId)}/shared_servers/${id}`, { method: 'PUT', body: { server_id: machineId, shared_server: { library_section_ids: ids } } });
}

// Stops sharing this server with them; they stay a Plex friend.
export async function plexShareRemove(cfg, shareId) {
  const id = shareIdOk(shareId);
  const machineId = await machineIdOf(cfg);
  await tvXml(cfg, `/api/servers/${encodeURIComponent(machineId)}/shared_servers/${id}`, { method: 'DELETE' });
}

// ------------------------------------------------------- compatibility
// Read-only: the server's version, whether the token works, whether titles
// carry TMDB/TVDB ids (Plex's current agents; the legacy agents don't), and
// whether plex.tv treats the token as the server owner's (needed for sharing).
export async function plexCompat(cfg) {
  const { t, base, cid } = await plexBase(cfg);
  const out = { version: null, token: false, sections: 0, locations: false, guids: null, owner: null, ownerError: null };
  const id = await pj(`${base}/identity`, t, cid);
  out.version = (id.MediaContainer && id.MediaContainer.version) || null;
  const mid = id.MediaContainer && id.MediaContainer.machineIdentifier;
  const sects = ((await pj(`${base}/library/sections`, t, cid)).MediaContainer || {}).Directory || [];
  out.token = true;
  const media = sects.filter((d) => d.type === 'movie' || d.type === 'show');
  out.sections = media.length;
  out.locations = media.some((d) => (d.Location || []).length);
  for (const d of media) {
    const data = await pj(`${base}/library/sections/${encodeURIComponent(d.key)}/all?includeGuids=1&X-Plex-Container-Start=0&X-Plex-Container-Size=5`, t, cid).catch(() => null);
    const items = (data && data.MediaContainer && data.MediaContainer.Metadata) || [];
    if (!items.length) continue;
    const withIds = items.filter((m) => Object.keys(plexIds(m)).length).length;
    out.guids = { checked: items.length, withIds, legacy: items.some((m) => /^com\.plexapp\.agents\./.test(String(m.guid || ''))) };
    if (withIds) break;
  }
  if (mid) {
    try { await tvXml(cfg, `/api/servers/${encodeURIComponent(mid)}`); out.owner = true; }
    catch (e) { out.owner = false; out.ownerError = e.message; }
  }
  return out;
}
