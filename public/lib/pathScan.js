// Path doctor scanner: asks Sonarr/Radarr (through the proxy) what is on the
// disks *they* can see, then hands the listings to the pure planner in
// pathDoctor.js. Everything here is read-only; applying lives in pathFix.js.
import {
  pathKey, listingArg, trimSep, splitPath, isSystemPath, prepItem, prepFolder, scorePrepared, findMissing, buildIndex, findCandidates, choosePlan,
} from './pathDoctor.js';

// What each app calls its library items and how to refresh them.
export const KINDS = {
  series: { path: 'series', noun: 'series', one: 'series', refresh: (ids) => ({ name: 'RefreshSeries', seriesIds: ids }) },
  movie: { path: 'movie', noun: 'movies', one: 'movie', refresh: (ids) => ({ name: 'RefreshMovie', movieIds: ids }) },
  artist: { path: 'artist', noun: 'artists', one: 'artist', refresh: (ids) => ({ name: 'RefreshArtist', artistIds: ids }) },
};
export const kindInfo = (kind) => KINDS[kind] || KINDS.movie;
// Lidarr items have artistName instead of title.
const withTitle = (it) => (it && !it.title && it.artistName ? { ...it, title: it.artistName } : it);

export const LIST_BUDGET = 160; // folder listings per scan, at most
const DEPTH = 3;               // how far below each disk or root to look

// Run `fn` over `list` with at most `limit` in flight.
export async function pool(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); }
  });
  await Promise.all(workers);
  return out;
}

// Directory children of `dir` as seen by the app, or null if it can't be read
// (doesn't exist, no permission, or a path from another OS).
export async function listDir(arr, dir) {
  try {
    const r = await arr.get(`filesystem?path=${encodeURIComponent(listingArg(dir))}&allowFoldersWithoutTrailingSlashes=true`);
    const dirs = (r && Array.isArray(r.directories)) ? r.directories : null;
    if (!dirs) return null;
    // Sonarr returns an empty list both for an empty folder and for one that
    // doesn't exist; only the parent's listing can tell them apart, which
    // findMissing does. Here an empty list is still "readable".
    return dirs.map((d) => ({ name: d.name, path: trimSep(d.path) }));
  } catch { return null; }
}

export async function scanLibrary(arr, { kind, onProgress = () => {} } = {}) {
  const itemsPath = kindInfo(kind).path;
  const [roots, disks, rawItems] = await Promise.all([
    arr.get('rootfolder').catch(() => []),
    arr.get('diskspace').catch(() => []),
    arr.get(itemsPath),
  ]);
  const items = (Array.isArray(rawItems) ? rawItems : []).filter((it) => it && it.path).map(withTitle);
  const listings = new Map();
  let budget = LIST_BUDGET;
  const list = async (dir) => {
    const k = pathKey(dir);
    if (listings.has(k) || budget <= 0) return listings.get(k) || null;
    budget -= 1;
    const children = await listDir(arr, dir);
    if (children) listings.set(k, children);
    onProgress({ listed: LIST_BUDGET - budget });
    return children;
  };

  // 1. Where every item should be: list each distinct parent folder once.
  const parents = [...new Map(items.map((it) => [pathKey(splitPath(it.path).parent), splitPath(it.path).parent])).values()];
  await pool(parents, 4, list);
  const missing = findMissing(items, listings);

  // 2. Where they might be now: walk the disks and root folders the app can
  // see, a few levels deep, without descending into folders that are
  // themselves media folders (their children are seasons or files).
  const seeds = [
    ...(Array.isArray(roots) ? roots : []).filter((r) => r.accessible !== false).map((r) => r.path),
    ...(Array.isArray(disks) ? disks : []).map((d) => d.path),
  ].filter((p) => p && !isSystemPath(p));
  // A folder that is (or looks like) a library item's folder holds seasons or
  // files, not more libraries, so the walk doesn't go inside it.
  const itemNames = new Set(items.map((it) => splitPath(it.path).name.toLowerCase()));
  const prepped = missing.map(prepItem);
  const byFirst = new Map();
  for (const pi of prepped) { if (!byFirst.has(pi.first)) byFirst.set(pi.first, []); byFirst.get(pi.first).push(pi); }
  const isMediaFolder = (name) => {
    if (itemNames.has(String(name).toLowerCase())) return true;
    const f = prepFolder(name);
    return (byFirst.get(f.tokens[0]) || []).some((pi) => scorePrepared(f, pi) >= 75);
  };
  let frontier = [...new Map(seeds.map((p) => [pathKey(p), trimSep(p)])).values()].map((p) => ({ path: p, depth: 0 }));
  if (missing.length) {
    while (frontier.length && budget > 0) {
      const level = frontier;
      frontier = [];
      const results = await pool(level, 4, async (f) => ({ f, children: await list(f.path) }));
      for (const { f, children } of results) {
        if (!children || f.depth >= DEPTH) continue;
        for (const c of children) {
          if (isSystemPath(c.path) || isMediaFolder(c.name) || c.name.startsWith('.')) continue;
          frontier.push({ path: c.path, depth: f.depth + 1 });
        }
      }
    }
  }

  // 3. Plan.
  const index = buildIndex(listings);
  const candidates = findCandidates(missing, index, { usedPaths: items.map((it) => it.path) });
  const plan = choosePlan(missing, candidates);

  // 4. A folder found by a similar (not identical) name must actually hold
  // video files before it's ticked. When several folders match equally well,
  // the one with video files wins; with none, the item goes to "Needs a look".
  const claimed = new Set(plan.filter((p) => p.newPath).map((p) => pathKey(p.newPath)));
  const countFiles = async (path) => {
    try { const f = await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(path)}`); return Array.isArray(f) ? f.length : null; }
    catch { return null; }
  };
  const toCheck = plan.filter((p) => p.newPath && p.score < 100);
  await pool(toCheck, 4, async (p) => {
    const ties = (p.candidates || []).filter((c) => c.score === p.score && (pathKey(c.path) === pathKey(p.newPath) || !claimed.has(pathKey(c.path)))).slice(0, 5);
    const counts = await Promise.all(ties.map((c) => countFiles(c.path)));
    const best = ties.map((c, i) => ({ c, n: counts[i] })).sort((x, y) => (y.n || 0) - (x.n || 0))[0];
    if (best && best.n > 0 && pathKey(best.c.path) !== pathKey(p.newPath)) {
      claimed.delete(pathKey(p.newPath));
      claimed.add(pathKey(best.c.path));
      p.newPath = best.c.path;
      p.newRoot = best.c.parent;
    }
    p.mediaFiles = best ? best.n : null;
    if (p.mediaFiles === 0 && p.status === 'found') { p.status = 'review'; p.reason = 'no video files inside'; }
    // A tie settled by video files: only one of the equally named folders has any.
    if (p.status === 'ambiguous' && best && best.n > 0 && counts.filter((n) => n > 0).length === 1) { p.status = 'found'; p.reason = 'the only match with video files'; }
  });
  return {
    items, roots: Array.isArray(roots) ? roots : [], disks: Array.isArray(disks) ? disks : [],
    missing, plan, listings, listed: LIST_BUDGET - budget, budgetHit: budget <= 0,
  };
}

// ---------------------------------------------------------------- applying
// changes: [{ id, title, oldPath, oldRoot, newPath, newRoot }]
// Re-points each item without moving files (moveFiles=false), using a fresh
// copy of the item so nothing else it holds is overwritten with stale data.
export async function applyChanges(arr, { kind, changes, addRoots = [], removeRoots = [], refresh = true, onProgress = () => {} }) {
  const itemsPath = kindInfo(kind).path;
  const result = { ok: [], failed: [], rootsAdded: [], rootsFailed: [], rootsRemoved: [], refreshed: false };
  for (const path of addRoots) {
    try { await arr.post('rootfolder', { path }); result.rootsAdded.push(path); }
    catch (e) {
      const msg = errorText(e);
      if (/already/i.test(msg)) result.rootsAdded.push(path); else result.rootsFailed.push({ path, error: msg });
    }
  }
  let done = 0;
  await pool(changes, 3, async (c) => {
    try {
      const fresh = await arr.get(`${itemsPath}/${c.id}`);
      const saved = await arr.put(`${itemsPath}/${c.id}?moveFiles=false`, { ...fresh, path: c.newPath, rootFolderPath: c.newRoot });
      // (Lidarr returns the artist too; same check.)
      if (saved && saved.path && saved.path !== c.newPath) throw new Error(`saved as ${saved.path}`);
      result.ok.push(c);
    } catch (e) { result.failed.push({ ...c, error: errorText(e) }); }
    done += 1;
    onProgress({ done, total: changes.length });
  });
  // Only remove an old root once nothing that was meant to leave it failed.
  for (const r of removeRoots) {
    const stuck = result.failed.some((f) => f.oldRoot && f.oldRoot.toLowerCase() === String(r.path).toLowerCase());
    if (stuck) continue;
    try { await arr.del(`rootfolder/${r.id}`); result.rootsRemoved.push(r.path); } catch { /* leave it */ }
  }
  if (refresh && result.ok.length) {
    const ids = result.ok.map((c) => c.id);
    try {
      await arr.post('command', kindInfo(kind).refresh(ids));
      result.refreshed = true;
    } catch { /* best effort */ }
  }
  return result;
}

// Put items back where they were before a fix.
export async function undoChanges(arr, { kind, record, onProgress }) {
  const back = (record && record.changes ? record.changes : []).map((c) => ({ ...c, newPath: c.oldPath, newRoot: c.oldRoot, oldPath: c.newPath, oldRoot: '' }));
  return applyChanges(arr, { kind, changes: back, refresh: true, onProgress });
}

function errorText(e) {
  const d = e && e.data;
  if (Array.isArray(d) && d[0] && d[0].errorMessage) return d.map((x) => x.errorMessage).join('; ');
  if (d && d.message) return d.message;
  return (e && e.message) || 'failed';
}
