// Duplicate scan (network side). Loads the library and root folders, checks
// which duplicate copies' folders still exist on disk (through Sonarr/Radarr's
// own filesystem API), counts video files in untracked copies, and compares
// against other instances of the same app. Read-only.
import { groupDuplicates, rankCopies, findUntrackedCopies, titleKey } from './duplicateFinder.js';
import { listDir, pool } from './pathScan.js';
import { pathKey, splitPath, listingArg } from './pathDoctor.js';
import { plexFolderSet, folderKeyOf } from './plexDupes.js';
import { showDuplicates } from './episodeDupes.js';

const ID_FIELDS = { movie: ['tmdbId', 'imdbId'], series: ['tvdbId', 'tmdbId', 'imdbId'] };

// onProgress({ stage, done, total }) while Sonarr's show folders are listed.
export async function scanDuplicates(arr, { kind, others = [], plexDuplicates = null, onProgress = () => {}, maxFolders = 3000 } = {}) {
  const itemsPath = kind === 'series' ? 'series' : 'movie';
  const [rawItems, rawRoots] = await Promise.all([arr.get(itemsPath), arr.get('rootfolder').catch(() => [])]);
  const items = Array.isArray(rawItems) ? rawItems : [];
  const roots = Array.isArray(rawRoots) ? rawRoots : [];

  const groups = groupDuplicates(items, kind);
  // Which duplicate copies are really on disk: list each parent folder once.
  const inGroups = groups.flatMap((g) => g.items).filter((it) => it.path);
  const listings = new Map();
  const parents = [...new Map(inGroups.map((it) => [pathKey(splitPath(it.path).parent), splitPath(it.path).parent])).values()];
  await pool(parents, 4, async (dir) => { const c = await listDir(arr, dir); if (c) listings.set(pathKey(dir), c); });
  const onDisk = new Map(inGroups.map((it) => {
    const { parent, name } = splitPath(it.path);
    const kids = listings.get(pathKey(parent));
    return [it.id, kids ? kids.some((c) => c.name.toLowerCase() === name.toLowerCase()) : false];
  }));
  const ranked = groups.map((g) => ({ ...g, ranked: rankCopies(g.items, kind, { onDisk }) }));

  // Copies on disk the app doesn't manage.
  const untracked = findUntrackedCopies(items, roots);
  await pool(untracked, 4, async (u) => {
    try { const f = await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(u.folder.path)}`); u.videoFiles = Array.isArray(f) ? f.length : null; u.files = Array.isArray(f) ? f : []; }
    catch { u.videoFiles = null; u.files = []; }
    // Is the managed copy still there? If not, the untracked one can replace it.
    const { parent, name } = splitPath(u.item.path || '');
    let kids = listings.get(pathKey(parent));
    if (!kids && parent) { kids = await listDir(arr, parent); if (kids) listings.set(pathKey(parent), kids); }
    u.managedOnDisk = kids ? kids.some((c) => c.name.toLowerCase() === name.toLowerCase()) : false;
  });

  // Copies Plex shows as duplicates (when Plex is connected).
  let plexItems = [];
  if (plexDuplicates) {
    try {
      plexItems = await plexDuplicates();
      const folders = plexFolderSet(plexItems);
      for (const u of untracked) u.inPlex = folders.has(folderKeyOf(u.folder.path));
    } catch { plexItems = []; /* Plex not available */ }
  }

  // The same title in another instance (e.g. Radarr and Radarr 4K).
  const fields = ID_FIELDS[kind] || [];
  const byId = new Map();
  for (const it of items) for (const f of fields) if (it[f]) byId.set(`${f}:${String(it[f]).toLowerCase()}`, it);
  const crossInstance = [];
  await pool(others, 2, async (o) => {
    let list;
    try { list = await o.arr.get(itemsPath); } catch { return; }
    for (const other of Array.isArray(list) ? list : []) {
      const hit = fields.map((f) => other[f] && byId.get(`${f}:${String(other[f]).toLowerCase()}`)).find(Boolean);
      if (hit) crossInstance.push({ item: hit, other, service: o.service, intended: /\b(4k|uhd|2160|remux|anime|kids)\b/i.test(o.service.label || o.service.key) });
    }
  });

  const perItem = kind === 'series' ? await listShowFolders(arr, { items, groups: ranked, untracked, plexItems, onProgress, maxFolders }) : null;
  const scan = { items, roots, groups: ranked, untracked, crossInstance, onDisk, perItem };
  if (perItem) scan.shows = buildShows(scan);
  return scan;
}

// ------------------------------------------------------ Sonarr, by show
// Every show's folder is listed once (shows with episode files, and every
// entry in a duplicate group), so episodes with more than one file can be
// found by season. Plex's duplicate episodes are matched to a show by its
// folder name in the file's path, or by title.
async function listShowFolders(arr, { items, groups, untracked, plexItems, onProgress, maxFolders }) {
  const grouped = new Set(groups.flatMap((g) => g.items.map((it) => it.id)));
  const perItem = new Map();
  const entry = (it) => { if (!perItem.has(it.id)) perItem.set(it.id, { item: it, files: [], untracked: [], plex: [] }); return perItem.get(it.id); };
  const toList = items.filter((it) => it.path && (grouped.has(it.id) || ((it.statistics && it.statistics.episodeFileCount) || 0) > 0)).slice(0, maxFolders);
  let done = 0;
  await pool(toList, 4, async (it) => {
    try { const f = await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(it.path)}`); entry(it).files = Array.isArray(f) ? f : []; }
    catch { entry(it); /* folder can't be read */ }
    onProgress({ stage: 'folders', done: ++done, total: toList.length });
  });
  for (const it of items) if (grouped.has(it.id)) entry(it);
  for (const u of untracked) entry(u.item).untracked.push(u);
  const byFolder = new Map(items.filter((it) => it.path).map((it) => [splitPath(it.path).name.toLowerCase(), it]));
  const byTitle = new Map(items.map((it) => [titleKey({ title: it.title }), it]));
  for (const p of plexItems || []) {
    if (p.type !== 'episode' || p.season == null || p.episode == null) continue;
    const segs = (p.parts || []).flatMap((x) => String(x.file || '').replace(/\\/g, '/').toLowerCase().split('/'));
    const hit = segs.map((seg) => byFolder.get(seg)).find(Boolean) || byTitle.get(titleKey({ title: p.show }));
    if (hit) entry(hit).plex.push({ season: Number(p.season), episode: Number(p.episode), parts: p.parts || [] });
  }
  return perItem;
}

// The shows to list: duplicate entries (unless marked "not a duplicate"),
// folders Sonarr doesn't manage, and episodes with more than one file. Pure,
// so the list can be rebuilt when a group is marked "not a duplicate".
export function buildShows(scan, ignored = new Set()) {
  const groups = (scan.groups || []).filter((g) => !ignored.has(g.key));
  const inGroup = new Map();
  for (const g of groups) for (const it of g.items) inGroup.set(it.id, g);
  const out = new Map();
  for (const [id, d] of scan.perItem || new Map()) {
    const g = inGroup.get(id);
    const key = g ? `g:${g.key}` : `s:${id}`;
    if (!out.has(key)) {
      const entries = g ? g.ranked.map((c) => c.item) : [d.item];
      out.set(key, { key, group: g || null, primary: entries[0], entries, title: g ? g.title : `${d.item.title}${d.item.year ? ` (${d.item.year})` : ''}`, untracked: [], plex: [], disk: [] });
    }
    const sh = out.get(key);
    sh.disk.push({ where: 'entry', entryId: id, folder: d.item.path, files: d.files });
    for (const u of d.untracked) { sh.untracked.push(u); sh.disk.push({ where: 'unmanaged', folder: u.folder.path, files: u.files || [] }); }
    sh.plex.push(...d.plex);
  }
  const list = [];
  for (const sh of out.values()) {
    const sum = showDuplicates({ entries: sh.entries.map((it) => ({ item: it, primary: it === sh.primary })), disk: sh.disk, plex: sh.plex });
    sh.summary = { episodes: sum.episodes, seasons: sum.seasons.map((x) => x.season) };
    if (sh.group || sh.untracked.length || sum.episodes) list.push(sh);
  }
  return list.sort((a, b) => a.title.localeCompare(b.title));
}

// One show in detail: which file Sonarr uses for each episode, episode
// titles, and the size of every other copy (from listing its folder).
export async function loadShowDetails(arr, show) {
  const entries = await Promise.all(show.entries.map(async (it) => {
    const [episodes, files] = await Promise.all([
      arr.get(`episode?seriesId=${encodeURIComponent(it.id)}`).catch(() => []),
      arr.get(`episodefile?seriesId=${encodeURIComponent(it.id)}`).catch(() => []),
    ]);
    return { item: it, primary: it === show.primary, episodes: Array.isArray(episodes) ? episodes : [], files: Array.isArray(files) ? files : [] };
  }));
  let result = showDuplicates({ entries, disk: show.disk, plex: show.plex });
  const dirs = new Set();
  for (const sn of result.seasons) for (const e of sn.episodes) for (const c of e.copies) if ((c.where === 'extra' || c.where === 'unmanaged') && c.size == null) dirs.add(splitPath(c.path).parent);
  const sizes = new Map();
  await pool([...dirs].slice(0, 80), 4, async (dir) => {
    try {
      const r = await arr.get(`filesystem?path=${encodeURIComponent(listingArg(dir))}&includeFiles=true&allowFoldersWithoutTrailingSlashes=true`);
      for (const f of (r && Array.isArray(r.files) ? r.files : [])) if (f && f.path && Number(f.size) > 0) sizes.set(pathKey(f.path), Number(f.size));
    } catch { /* sizes stay unknown */ }
  });
  if (sizes.size) result = showDuplicates({ entries, disk: show.disk, plex: show.plex, sizes });
  return { ...result, entries };
}
