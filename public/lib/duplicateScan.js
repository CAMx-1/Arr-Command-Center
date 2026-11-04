// Duplicate scan (network side). Loads the library and root folders, checks
// which duplicate copies' folders still exist on disk (through Sonarr/Radarr's
// own filesystem API), counts video files in untracked copies, and compares
// against other instances of the same app. Read-only.
import { groupDuplicates, rankCopies, findUntrackedCopies } from './duplicateFinder.js';
import { listDir, pool } from './pathScan.js';
import { pathKey, splitPath } from './pathDoctor.js';
import { plexFolderSet, folderKeyOf } from './plexDupes.js';

const ID_FIELDS = { movie: ['tmdbId', 'imdbId'], series: ['tvdbId', 'tmdbId', 'imdbId'] };

export async function scanDuplicates(arr, { kind, others = [], plexDuplicates = null } = {}) {
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
    try { const f = await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(u.folder.path)}`); u.videoFiles = Array.isArray(f) ? f.length : null; }
    catch { u.videoFiles = null; }
    // Is the managed copy still there? If not, the untracked one can replace it.
    const { parent, name } = splitPath(u.item.path || '');
    let kids = listings.get(pathKey(parent));
    if (!kids && parent) { kids = await listDir(arr, parent); if (kids) listings.set(pathKey(parent), kids); }
    u.managedOnDisk = kids ? kids.some((c) => c.name.toLowerCase() === name.toLowerCase()) : false;
  });

  // Copies Plex shows as duplicates (when Plex is connected).
  if (plexDuplicates) {
    try {
      const folders = plexFolderSet(await plexDuplicates());
      for (const u of untracked) u.inPlex = folders.has(folderKeyOf(u.folder.path));
    } catch { /* Plex not available */ }
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

  return { items, roots, groups: ranked, untracked, crossInstance, onDisk };
}
