// Setup doctor: read-only checks for the mistakes that quietly break *arr
// setups, each with a plain fix. It only reads (settings, folder listings,
// download lists); nothing is changed. Results name hosts and paths but never
// keys or passwords.
//
// Checks: unreachable root folders; no download client; completed download
// handling off; download client categories (missing, shared by two apps, or
// with finished downloads nobody watches); download folders the app can't see
// (remote path mappings); torrent downloads on another disk than the library
// (no hard links); hard links turned off; Prowlarr indexers missing from an
// app, left over, or apps not connected; and the apps' own health warnings.
import { serviceGet as defaultGet, qbitApi as defaultQbit } from './proxy.js';

const APPS = { sonarr: 'v3', radarr: 'v3', whisparr: 'v3', lidarr: 'v1', readarr: 'v1' };
const LIST = { sonarr: 'series', whisparr: 'series', radarr: 'movie', lidarr: 'artist', readarr: 'author' };
const NOUN = { sonarr: ['series', 'series'], whisparr: ['series', 'series'], radarr: ['movie', 'movies'], lidarr: ['artist', 'artists'], readarr: ['author', 'authors'] };
const CLIENTS = { qbittorrent: 'qBittorrent', sabnzbd: 'SABnzbd', transmission: 'Transmission', deluge: 'Deluge', nzbget: 'NZBGet', flood: 'Flood' };
const PROWLARR_APPS = new Set(['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr']);
export const HARDLINK_GUIDE = 'https://trash-guides.info/File-and-Folder-Structure/Hardlinks-and-Instant-Moves/';
const ORDER = { problem: 0, warning: 1, info: 2 };

// ------------------------------------------------------------ paths
export const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const sepOf = (p) => (String(p).includes('\\') && !String(p).includes('/') ? '\\' : '/');
export function parentOf(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i <= 0 ? (s.startsWith('/') ? '/' : s) : s.slice(0, i);
}
const under = (child, parent) => { const c = normPath(child); const p = normPath(parent); return p === '' ? c.startsWith('/') || c === '' : c === p || c.startsWith(`${p}/`); };

// The path as the app sees it, after its remote path mappings for this host.
export function applyMapping(path, mappings, host) {
  const p = String(path || '');
  const m = (mappings || []).filter((x) => String(x.host || '').toLowerCase() === String(host || '').toLowerCase())
    .sort((a, b) => normPath(b.remotePath).length - normPath(a.remotePath).length)
    .find((x) => normPath(x.remotePath) !== '' && under(p, x.remotePath));
  if (!m) return { path: p, mapping: null };
  const rest = p.replace(/\\/g, '/').replace(/\/+$/, '').slice(normPath(m.remotePath).length).replace(/^\/+/, '');
  const local = String(m.localPath || '').replace(/[\\/]+$/, '');
  const s = sepOf(m.localPath);
  return { path: rest ? `${local}${s}${rest.split('/').join(s)}` : local, mapping: m };
}

// The disk (from the app's diskspace list) a path is on: the longest prefix.
export function diskOf(path, disks) {
  return (disks || []).filter((d) => d && d.path && under(path, d.path)).sort((a, b) => normPath(b.path).length - normPath(a.path).length)[0] || null;
}
const diskName = (d) => (d.label && d.label !== d.path ? `${d.label} (${d.path})` : d.path);

// ------------------------------------------------------------ download clients
const field = (c, name) => { const f = (c.fields || []).find((x) => x.name === name); return f ? f.value : undefined; };
// The category field ("tvCategory", "movieCategory", …), not the after-import one.
export function categoryOf(c) {
  const f = (c.fields || []).find((x) => /Category$/.test(x.name) && !/(Imported|PostImport|Older|Recent)/i.test(x.name));
  return f ? { field: f.name, value: String(f.value || '').trim() } : { field: null, value: '' };
}
export const importedCategoryOf = (c) => String(((c.fields || []).find((x) => /ImportedCategory$/.test(x.name)) || {}).value || '').trim();
const hostOf = (u) => { try { const x = new URL(u); return { host: x.hostname.toLowerCase(), port: String(x.port || (x.protocol === 'https:' ? 443 : 80)) }; } catch { return null; } };
const local = (h) => (/^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(h) ? 'local' : h);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The Arr Command Center service an app's download client points at: same
// host and port, then the host named like a service, then the only service of
// that type. null when it can't be told.
export function matchClient(c, services) {
  const type = String(c.implementation || '').toLowerCase();
  const list = Object.entries(services || {}).filter(([, s]) => s.type === type && s.enabled !== false);
  if (!list.length) return null;
  const host = local(String(field(c, 'host') || '').toLowerCase()); const port = String(field(c, 'port') || '');
  const exact = list.filter(([, s]) => { const h = hostOf(s.baseUrl); return h && local(h.host) === host && h.port === port; });
  if (exact.length === 1) return exact[0];
  const named = list.filter(([k, s]) => slug(k) === slug(host) || slug(s.label) === slug(host));
  if (named.length === 1) return named[0];
  return list.length === 1 ? list[0] : null;
}

// What a finished download's folder looks like in each client, by category.
export function clientFolders(kind, data) {
  const by = new Map();
  const add = (cat, folder, name) => { const k = String(cat || ''); const e = by.get(k) || { category: k, folders: new Map(), names: [] }; if (folder) e.folders.set(folder, (e.folders.get(folder) || 0) + 1); if (name) e.names.push(name); by.set(k, e); };
  if (kind === 'qbittorrent') for (const t of data || []) { if (Number(t.progress) >= 1) add(t.category, t.save_path, t.name); }
  if (kind === 'sabnzbd') for (const j of data || []) { if (String(j.status).toLowerCase() === 'completed') add(j.category, j.storage ? parentOf(j.storage) : null, j.name); }
  return [...by.values()].map((e) => ({ category: e.category, names: e.names, folder: [...e.folders.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)[0] || null }));
}

// ------------------------------------------------------------ Prowlarr
const PROWLARR_SUFFIX = / \(Prowlarr\)$/;
export function matchProwlarrApps(pApps, apps) {
  const out = new Map(); const taken = new Set();
  const typed = (t) => apps.filter((a) => a.type === t && !taken.has(a.key));
  for (const p of pApps) {
    const type = String(p.implementation || '').toLowerCase();
    if (!PROWLARR_APPS.has(type)) continue;
    const u = hostOf(field(p, 'baseUrl'));
    const cands = typed(type);
    const pick = (u && cands.find((a) => { const h = hostOf(a.baseUrl); return h && local(h.host) === local(u.host) && h.port === u.port; }))
      || (u && cands.filter((a) => (hostOf(a.baseUrl) || {}).port === u.port).length === 1 && cands.find((a) => (hostOf(a.baseUrl) || {}).port === u.port))
      || cands.find((a) => slug(a.label) === slug(p.name))
      || (cands.length === 1 && pApps.filter((x) => String(x.implementation || '').toLowerCase() === type).length === 1 ? cands[0] : null);
    if (pick) { out.set(pick.key, p); taken.add(pick.key); }
  }
  return out;
}
const idsOf = (cats) => (cats || []).flatMap((c) => [Number(c.id), ...(c.subCategories || []).map((x) => Number(x.id))]);
// Prowlarr syncs an indexer to an app when their tags overlap (if the app has
// tags) and the indexer has a category the app wants.
export function syncsTo(ix, pApp) {
  const appTags = pApp.tags || [];
  if (appTags.length && !(ix.tags || []).some((t) => appTags.includes(t))) return false;
  const want = [...(field(pApp, 'syncCategories') || []), ...(field(pApp, 'animeSyncCategories') || [])].map(Number);
  const have = idsOf((ix.capabilities || {}).categories);
  if (!want.length || !have.length) return true;
  return have.some((id) => want.includes(id) || want.includes(Math.floor(id / 1000) * 1000) || want.some((w) => Math.floor(w / 1000) * 1000 === id));
}

// ------------------------------------------------------------ health
// Titles take (names, many) so one finding can name several apps.
const has = (m) => (m ? 'have' : 'has');
const HEALTH = {
  IndexerStatusCheck: { title: (a, m) => `${a} ${has(m)} indexers that are failing`, fix: 'They’re retried automatically. If it keeps happening, test them (in Prowlarr if you use it) and check the indexer’s site and your API key there.' },
  IndexerLongTermStatusCheck: { title: (a, m) => `${a} ${has(m)} indexers that have been failing for hours`, fix: 'Test them (in Prowlarr if you use it), and check the indexer’s site and your account there.' },
  IndexerRssCheck: { title: (a, m) => `${a} ${has(m)} no indexer with RSS turned on`, fix: 'Turn on RSS for at least one indexer (Settings → Indexers), or new releases won’t be grabbed automatically.' },
  IndexerSearchCheck: { title: (a, m) => `${a} ${has(m)} no indexer with automatic search turned on`, fix: 'Turn on Automatic Search for at least one indexer (Settings → Indexers).' },
  DownloadClientCheck: { title: (a) => `${a} can’t reach a download client`, fix: 'Check the client is running, and its host, port and login in Settings → Download Clients (Test).' },
  DownloadClientStatusCheck: { title: (a, m) => `${a} ${has(m)} a download client that keeps failing`, fix: 'Check the client is running, and its host, port and login in Settings → Download Clients (Test).' },
  RemotePathMappingCheck: { title: (a, m) => `${a} ${m ? 'report' : 'reports'} a download folder problem`, fix: 'Usually a missing or wrong remote path mapping (Settings → Download Clients → Remote Path Mappings), or the downloads folder isn’t mounted in the app’s container.' },
  DownloadClientSortingCheck: { title: (a) => `SABnzbd sorting is on for a category ${a} uses`, fix: 'Turn off sorting for that category in SABnzbd (Config → Sorting): the app renames and sorts files itself.' },
  DownloadClientRootFolderCheck: { title: (a) => `A download client saves into a library folder of ${a}`, fix: 'Give the download client its own folder, outside the library root folders.' },
  MountCheck: { title: (a) => `A library folder of ${a} is on a read-only mount`, fix: 'Mount it read-write, or the app can’t import, rename or delete files.' },
  ImportMechanismCheck: { title: (a) => `${a} won’t import finished downloads`, fix: 'Turn on Completed Download Handling in Settings → Download Clients.' },
  UpdateCheck: { title: (a, m) => `${a} can’t update ${m ? 'themselves' : 'itself'}`, fix: 'Usually fine in Docker: update by pulling a newer image.' },
  SystemTimeCheck: { title: (a, m) => `The clock is off on ${a}`, fix: 'Set the server’s time (NTP); indexers and logins fail when the clock is wrong.' },
};
const SKIP_HEALTH = new Set(['RootFolderCheck']); // covered by the root folder check

// ------------------------------------------------------------ analysis (pure)
// apps: [{ key, label, type, baseUrl, roots, disks, items, clients, mappings, mm, dlcfg, health, indexers }]
// clients: { [key]: { label, type, folders: [{ category, folder, names }] } }
// paths: [{ app, clientKey, clientLabel, host, protocol, category, clientPath, mapped, mapping, exists }]
// prowlarr: { key, label, apps, indexers, health } | null
export function analyze({ apps = [], clients = {}, paths = [], prowlarr = null }) {
  const out = [];
  const add = (f) => out.push(f);
  const L = (k) => (apps.find((a) => a.key === k) || {}).label || k;
  const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const allOf = (n) => (n === 2 ? 'both' : 'all');

  for (const a of apps) {
    const [one, many] = NOUN[a.type] || ['item', 'items'];
    // Root folders the app can't reach.
    const bad = (a.roots || []).filter((r) => r.accessible === false);
    if (bad.length) {
      const counts = bad.map((r) => (a.items || []).filter((it) => normPath(it.rootFolderPath || parentOf(it.path)) === normPath(r.path)).length);
      const n = counts.reduce((x, y) => x + y, 0);
      add({ id: `${a.key}:roots`, severity: 'problem', area: 'Library folders', services: [a.key], title: `${a.label} can’t reach ${bad.length === 1 ? 'its root folder' : `${bad.length} of its root folders`} ${list(bad.map((r) => r.path))}`,
        detail: n ? `${n} ${n === 1 ? one : many} ${n === 1 ? 'is' : 'are'} stored there, so ${a.label} can’t import, upgrade or rename ${n === 1 ? 'it' : 'them'}.` : 'Nothing is stored there right now.',
        fix: `Check the drive is connected and that the folder exists inside ${a.label}’s container (Docker volume). If the library moved, Fix paths re-points the ${many} without moving files.`,
        link: ['sonarr', 'radarr', 'whisparr'].includes(a.type) ? { href: `#/${encodeURIComponent(a.key)}?tab=system&tool=fixpaths`, label: 'Open Fix paths' } : null });
    }
    if (a.clients) {
      const enabled = a.clients.filter((c) => c.enable !== false);
      if (!enabled.length) add({ id: `${a.key}:no-client`, severity: 'problem', area: 'Downloads', services: [a.key], title: `${a.label} has no download client turned on`, detail: `It can find releases but can’t download any.`, fix: `Add one in ${a.label} → Settings → Download Clients.` });
    }
    if (a.dlcfg && a.dlcfg.enableCompletedDownloadHandling === false) add({ id: `${a.key}:cdh`, severity: 'problem', area: 'Downloads', services: [a.key], title: `${a.label} won’t import finished downloads`, detail: 'Completed Download Handling is off, so finished downloads stay in the download client.', fix: `Turn on Completed Download Handling in ${a.label} → Settings → Download Clients.` });
    const torrent = (a.clients || []).some((c) => c.enable !== false && c.protocol === 'torrent');
    if (torrent && a.mm && a.mm.copyUsingHardlinks === false) add({ id: `${a.key}:hardlinks-off`, severity: 'warning', area: 'Downloads', services: [a.key], title: `${a.label} copies torrent imports instead of hard-linking them`, detail: '“Use Hardlinks instead of Copy” is off, so each import is a full copy and seeding torrents take up twice the space.', fix: `Turn it on in ${a.label} → Settings → Media Management (Show Advanced → Importing).`, link: { href: HARDLINK_GUIDE, label: 'TRaSH: hard links' } });
  }

  // Categories: empty, or the same client category used by two apps.
  const uses = new Map(); const watched = new Map();
  for (const a of apps) for (const c of (a.clients || []).filter((x) => x.enable !== false)) {
    const cat = categoryOf(c); const clientName = CLIENTS[String(c.implementation || '').toLowerCase()] || c.name || c.implementation;
    const ident = c.target ? `acc:${c.target}` : `${String(c.implementation).toLowerCase()}:${field(c, 'host')}:${field(c, 'port')}`;
    if (c.target) { const w = watched.get(c.target) || new Set(); if (cat.value) w.add(cat.value.toLowerCase()); const imp = importedCategoryOf(c); if (imp) w.add(imp.toLowerCase()); watched.set(c.target, w); }
    if (cat.field && !cat.value) { add({ id: `${a.key}:no-category:${c.id}`, severity: 'warning', area: 'Downloads', services: [a.key], title: `${a.label} sends downloads to ${clientName} without a category`, detail: 'Without its own category, its downloads are mixed with everything else in the client, and other apps can see them.', fix: `Set a category (for example ${a.type === 'radarr' ? 'radarr' : a.type === 'lidarr' ? 'lidarr' : a.type === 'readarr' ? 'readarr' : 'tv-sonarr'}) in ${a.label} → Settings → Download Clients → ${clientName}.` }); continue; }
    if (!cat.value) continue;
    const k = `${ident}|${cat.value.toLowerCase()}`;
    const e = uses.get(k) || { clientName, category: cat.value, apps: [] };
    if (!e.apps.includes(a.key)) e.apps.push(a.key);
    uses.set(k, e);
  }
  for (const [k, e] of uses) if (e.apps.length > 1) add({ id: `shared:${k}`, severity: 'warning', area: 'Downloads', services: e.apps, title: `${list(e.apps.map(L))} ${allOf(e.apps.length)} use ${e.clientName}’s “${e.category}” category`, detail: 'Each app sees the others’ downloads in its queue, can’t import them, and may report them as stuck.', fix: `Give each app its own category (for example “${e.category}” and “${e.category}-${slug(L(e.apps[1])).replace(/^(sonarr|radarr)/, '') || '2'}”) in its Settings → Download Clients.` });

  // Finished downloads in a category no app watches.
  const GUESS = [[/movie|film|radarr/i, 'radarr'], [/tv|show|series|sonarr|anime/i, 'sonarr'], [/music|audio|lidarr/i, 'lidarr'], [/book|readarr/i, 'readarr']];
  for (const [ck, cl] of Object.entries(clients)) {
    const w = watched.get(ck) || new Set();
    for (const f of cl.folders || []) {
      if (!f.category || f.category === '*' || /^default$/i.test(f.category) || w.has(f.category.toLowerCase()) || !f.names.length) continue;
      const guess = (GUESS.find(([re]) => re.test(f.category)) || [])[1];
      const app = guess && apps.find((a) => a.type === guess && (a.clients || []).some((c) => c.target === ck && c.enable !== false));
      const appCat = app ? categoryOf((app.clients || []).find((c) => c.target === ck)).value : null;
      add({ id: `unwatched:${ck}:${f.category}`, severity: 'info', area: 'Downloads', services: [ck], title: `${cl.label} has ${f.names.length} finished ${f.names.length === 1 ? 'download' : 'downloads'} in “${f.category}”, a category no app watches`,
        detail: `${f.names.slice(0, 3).join(', ')}${f.names.length > 3 ? '…' : ''}. Nothing will import ${f.names.length === 1 ? 'it' : 'them'}.`,
        fix: app ? `If they’re for ${app.label}: it watches “${appCat}” in ${cl.label}. Import these with ${app.label}’s Manual Import (Wanted → Manual Import), and check ${app.label} sends new downloads to the category you expect. Ignore this if you added them yourself.` : 'If an app should import these, check which category it uses in its Settings → Download Clients, or import them with its Manual Import. Ignore this if you added them yourself.' });
    }
  }

  // Download folders the app can't see, and torrents on another disk.
  for (const p of paths) {
    const a = apps.find((x) => x.key === p.app); if (!a) continue;
    if (p.exists === false) {
      add({ id: `${a.key}:path:${p.clientKey}:${p.category}`, severity: 'problem', area: 'Download folders', services: [a.key, p.clientKey],
        title: p.mapping ? `${a.label}’s remote path mapping for ${p.clientLabel} points to a folder it can’t see` : `${a.label} can’t see where ${p.clientLabel} saves its downloads`,
        detail: p.mapping ? `${p.clientLabel} saves ${a.label}’s downloads (category “${p.category}”) in ${p.clientPath}. The mapping turns that into ${p.mapped}, which doesn’t exist for ${a.label}.` : `${p.clientLabel} saves ${a.label}’s downloads (category “${p.category}”) in ${p.clientPath}, and ${a.label} can’t find that folder. Finished downloads won’t import.`,
        fix: p.mapping ? `Correct the local path of that mapping in ${a.label} → Settings → Download Clients → Remote Path Mappings, to where ${a.label} sees ${p.clientPath}.` : `Simplest: mount the downloads folder at the same path in both containers. Otherwise add a remote path mapping in ${a.label} → Settings → Download Clients → Remote Path Mappings: host ${p.host}, remote path ${parentOf(p.clientPath)}${sepOf(p.clientPath)}, local path = that folder as ${a.label} sees it.` });
      continue;
    }
    if (p.exists !== true || p.protocol !== 'torrent') continue;
    const dl = diskOf(p.mapped, a.disks);
    const roots = (a.roots || []).filter((r) => r.accessible !== false);
    const other = roots.map((r) => ({ r, d: diskOf(r.path, a.disks) })).filter((x) => dl && x.d && normPath(x.d.path) !== normPath(dl.path));
    if (dl && other.length) add({ id: `${a.key}:disk:${p.clientKey}`, severity: 'warning', area: 'Download folders', services: [a.key, p.clientKey], title: `${a.label} copies imports from ${p.clientLabel} instead of hard-linking`,
      detail: `${p.clientLabel}’s downloads (${p.mapped}) are on ${diskName(dl)}, and ${list(other.map((x) => x.r.path))} ${other.length === 1 ? 'is' : 'are'} on ${list([...new Set(other.map((x) => diskName(x.d)))])}. Hard links only work within one disk (and one mount, in Docker), so each import is a full copy and seeding torrents take up twice the space.`,
      fix: 'Keep downloads and media in one folder on one disk, mounted once into every container (for example /data/torrents and /data/media).', link: { href: HARDLINK_GUIDE, label: 'TRaSH: hard links' } });
  }

  // Prowlarr: indexers missing from an app or left over, and apps not connected.
  if (prowlarr) {
    const matched = matchProwlarrApps(prowlarr.apps || [], apps);
    const enabled = (prowlarr.indexers || []).filter((x) => x.enable);
    const known = new Set((prowlarr.indexers || []).map((x) => String(x.name).toLowerCase()));
    for (const [key, pApp] of matched) {
      const a = apps.find((x) => x.key === key);
      if (pApp.syncLevel === 'disabled') { add({ id: `${key}:prowlarr-off`, severity: 'info', area: 'Indexers', services: [key, prowlarr.key], title: `Prowlarr’s sync to ${a.label} is turned off`, detail: 'New indexers in Prowlarr won’t reach it.', fix: `Set Sync Level to Full Sync in Prowlarr → Settings → Apps → ${pApp.name}.` }); continue; }
      if (!a.indexers) continue;
      const have = new Set(a.indexers.filter((x) => PROWLARR_SUFFIX.test(x.name)).map((x) => x.name.replace(PROWLARR_SUFFIX, '').toLowerCase()));
      const missing = enabled.filter((ix) => syncsTo(ix, pApp) && !have.has(String(ix.name).toLowerCase()));
      if (missing.length) add({ id: `${key}:prowlarr-missing`, severity: 'warning', area: 'Indexers', services: [key, prowlarr.key], title: `${a.label} is missing ${missing.length === 1 ? 'an indexer' : `${missing.length} indexers`} from Prowlarr: ${list(missing.map((x) => x.name))}`,
        detail: `Prowlarr should sync ${missing.length === 1 ? 'it' : 'them'} to ${a.label}, but ${a.label} doesn’t have ${missing.length === 1 ? 'it' : 'them'}.`,
        fix: `In Prowlarr: Settings → Apps → ${pApp.name} → Test, then System → Tasks → Application Indexer Sync. If the test fails, check ${a.label}’s address and API key there.` });
      const leftover = a.indexers.filter((x) => PROWLARR_SUFFIX.test(x.name) && !known.has(x.name.replace(PROWLARR_SUFFIX, '').toLowerCase()));
      if (leftover.length) add({ id: `${key}:prowlarr-leftover`, severity: 'info', area: 'Indexers', services: [key], title: `${a.label} still has ${leftover.length === 1 ? 'an indexer' : `${leftover.length} indexers`} Prowlarr no longer has: ${list(leftover.map((x) => x.name.replace(PROWLARR_SUFFIX, '')))}`,
        detail: 'Usually renamed in Prowlarr or left from an earlier Prowlarr setup. Searches through it are likely to fail.',
        fix: `Delete ${leftover.length === 1 ? 'it' : 'them'} in ${a.label} → Settings → Indexers.${pApp.syncLevel === 'addOnly' ? ` With Sync Level “Add and Remove Only”, Prowlarr doesn’t pass on renames; “Full Sync” keeps names matched.` : ''}` });
    }
    const loose = apps.filter((a) => PROWLARR_APPS.has(a.type) && !matched.has(a.key));
    if (loose.length) add({ id: 'prowlarr-unconnected', severity: 'info', area: 'Indexers', services: loose.map((a) => a.key), title: `${list(loose.map((a) => a.label))} ${loose.length === 1 ? 'isn’t' : 'aren’t'} connected to Prowlarr`, detail: 'They only have the indexers added to them by hand.', fix: 'Add them in Prowlarr → Settings → Apps, so they get Prowlarr’s indexers. Ignore this if you manage their indexers yourself.' });
  }

  // The apps' own health warnings, with plain fixes where they're known. The
  // same warning from several apps (the same failing indexer) is one finding.
  const groups = new Map();
  for (const a of [...apps, ...(prowlarr ? [{ key: prowlarr.key, label: prowlarr.label, health: prowlarr.health }] : [])]) {
    for (const h of a.health || []) {
      if (SKIP_HEALTH.has(h.source)) continue;
      if (h.source === 'RemotePathMappingCheck' && out.some((f) => f.area === 'Download folders' && f.services[0] === a.key && f.severity === 'problem')) continue;
      const k = `${h.source}|${h.message}`;
      const g = groups.get(k) || { h, apps: [] };
      g.apps.push(a); groups.set(k, g);
    }
  }
  for (const { h, apps: as } of groups.values()) {
    const known = HEALTH[h.source]; const names = list(as.map((a) => a.label)); const many = as.length > 1;
    add({ id: `health:${as.map((a) => a.key).join(',')}:${h.source || h.message}`, severity: h.type === 'error' ? 'problem' : h.type === 'notice' ? 'info' : 'warning', area: 'App health', services: as.map((a) => a.key),
      title: known ? known.title(names, many) : `${names}: ${h.message}`, detail: known ? h.message : '',
      fix: !known ? `See ${as[0].label} → System → Status for details.` : prowlarr && as.every((a) => a.key === prowlarr.key) ? known.fix.replace(' (in Prowlarr if you use it)', ' in Prowlarr → Indexers') : known.fix,
      link: /^https:\/\/wiki\.servarr\.com\//.test(String(h.wikiUrl || '')) ? { href: h.wikiUrl, label: 'Servarr wiki' } : null });
  }
  const seen = new Set();
  return out.filter((f) => (seen.has(f.id) ? false : seen.add(f.id))).sort((x, y) => ORDER[x.severity] - ORDER[y.severity] || L(x.services[0]).localeCompare(L(y.services[0])));
}

// ------------------------------------------------------------ collecting (I/O)
export async function runDoctor(cfg, { get = defaultGet, qbit = defaultQbit, canSee = () => true } = {}) {
  const errors = [];
  const services = Object.fromEntries(Object.entries(cfg.services || {}).filter(([k, s]) => s.enabled !== false && canSee(k)));
  const soft = (p, what) => p.catch((e) => { errors.push(`${what}: ${e.message}`); return null; });
  const apps = await Promise.all(Object.entries(services).filter(([, s]) => APPS[s.type]).map(async ([key, s]) => {
    const v = APPS[s.type]; const label = s.label || key;
    const [roots, disks, items, clients, mappings, mm, dlcfg, health, indexers] = await Promise.all([
      soft(get(s, `api/${v}/rootfolder`), `${label} root folders`), get(s, `api/${v}/diskspace`).catch(() => []), get(s, `api/${v}/${LIST[s.type]}`, { timeout: 30000 }).catch(() => []),
      soft(get(s, `api/${v}/downloadclient`), `${label} download clients`), get(s, `api/${v}/remotepathmapping`).catch(() => []), get(s, `api/${v}/config/mediamanagement`).catch(() => null),
      get(s, `api/${v}/config/downloadclient`).catch(() => null), get(s, `api/${v}/health`).catch(() => []), get(s, `api/${v}/indexer`).catch(() => null),
    ]);
    const cl = clients ? clients.map((c) => { const m = matchClient(c, services); return { ...c, target: m ? m[0] : null }; }) : null;
    return { key, label, type: s.type, v, svc: s, baseUrl: s.baseUrl, roots: roots || [], disks: disks || [], items: items || [], clients: cl, mappings: mappings || [], mm, dlcfg, health: health || [], indexers };
  }));

  // What the download clients hold, by category (qBittorrent, SABnzbd).
  const clients = {};
  await Promise.all(Object.entries(services).filter(([, s]) => s.type === 'qbittorrent' || s.type === 'sabnzbd').map(async ([key, s]) => {
    const label = s.label || CLIENTS[s.type];
    if (s.type === 'qbittorrent') { const t = await soft(qbit(s, key, 'torrents/info'), `${label} torrents`); if (t) clients[key] = { label, type: s.type, folders: clientFolders('qbittorrent', t) }; }
    else { const d = await soft(get(s, 'api?mode=history&limit=100&output=json'), `${label} history`); if (d) clients[key] = { label, type: s.type, folders: clientFolders('sabnzbd', (d.history || {}).slots) }; }
  }));

  // Can each app see where its client saves its downloads?
  const listings = new Map();
  const exists = async (a, path) => {
    const p = String(path).replace(/[\\/]+$/, '');
    if (!p || p === '/' || /^[A-Za-z]:$/.test(p)) return true;
    const parent = parentOf(p); const s = sepOf(p);
    const dir = parent.endsWith(s) ? parent : `${parent}${s}`;
    const name = p.slice(p.replace(/\\/g, '/').lastIndexOf('/') + 1).toLowerCase();
    const k = `${a.key}|${dir}`;
    if (!listings.has(k)) listings.set(k, get(a.svc, `api/${a.v}/filesystem?path=${encodeURIComponent(dir)}&includeFiles=false&allowFoldersWithoutTrailingSlashes=true`).then((d) => ((d && d.directories) || []).map((x) => String(x.name).toLowerCase())).catch(() => null));
    const names = await listings.get(k);
    return names === null ? null : names.includes(name);
  };
  const paths = [];
  for (const a of apps) for (const c of (a.clients || []).filter((x) => x.enable !== false && x.target && clients[x.target])) {
    const cat = categoryOf(c).value; if (!cat) continue;
    const f = clients[c.target].folders.find((x) => x.category.toLowerCase() === cat.toLowerCase());
    if (!f || !f.folder) continue; // nothing finished in that category yet
    const host = String(field(c, 'host') || '');
    const m = applyMapping(f.folder, a.mappings, host);
    paths.push({ app: a.key, clientKey: c.target, clientLabel: clients[c.target].label, host, protocol: c.protocol, category: cat, clientPath: f.folder, mapped: m.path, mapping: m.mapping, exists: await exists(a, m.path) });
  }

  let prowlarr = null;
  const px = Object.entries(services).find(([, s]) => s.type === 'prowlarr');
  if (px) {
    const [pApps, pIdx, pHealth] = await Promise.all([soft(get(px[1], 'api/v1/applications'), 'Prowlarr apps'), soft(get(px[1], 'api/v1/indexer'), 'Prowlarr indexers'), get(px[1], 'api/v1/health').catch(() => [])]);
    if (pApps && pIdx) prowlarr = { key: px[0], label: px[1].label || 'Prowlarr', apps: pApps, indexers: pIdx, health: pHealth || [] };
  }
  const findings = analyze({ apps, clients, paths, prowlarr });
  return {
    at: Date.now(), findings, errors,
    checked: { apps: apps.map((a) => ({ key: a.key, label: a.label })), clients: Object.entries(clients).map(([k, c]) => ({ key: k, label: c.label })), prowlarr: !!prowlarr, paths: paths.length },
    counts: { problem: findings.filter((f) => f.severity === 'problem').length, warning: findings.filter((f) => f.severity === 'warning').length, info: findings.filter((f) => f.severity === 'info').length },
  };
}
