// Import a better copy that's already on disk with Sonarr's or Radarr's own
// Manual Import: "Keep this copy instead" (Radarr) and "Use the better
// copies" (Sonarr, per episode). Arr Command Center never touches the drives.
//
// Sonarr and Radarr ignore GET manualimport's folder when a seriesId or
// movieId is given (they list that item's own files instead), so the files
// are listed here and each one is sent to POST manualimport, which evaluates
// it for the chosen series or movie: episodes, quality, languages, rejections.
//
// A file from another folder is moved in by Sonarr/Radarr, which removes the
// file it replaces (Recycle Bin if set). A file already inside the show's
// folder is imported where it is and Sonarr keeps the old file too, so the old
// one is then deleted through Sonarr (Recycle Bin if set) once no episode uses
// it, and the new one is renamed when Rename Episodes is on.
import { buildImportCommand, commandOutcome } from './manualImport.js';
import { pathKey, splitPath, listingArg } from './pathDoctor.js';
import { pool } from './pathScan.js';
import { isEpisodeFile, episodeNumbers, episodeCode } from './episodeDupes.js';

const RANK = (q) => {
  const r = Number(q && q.quality && q.quality.resolution) || 0;
  const name = String((q && q.quality && q.quality.name) || '');
  return r * 10 + (/remux/i.test(name) ? 3 : /bluray/i.test(name) ? 2 : /web/i.test(name) ? 1 : 0);
};

// What Sonarr/Radarr's own Manual Import sends for a file it hasn't looked at:
// unknown quality and language, so both are read from the file.
const UNKNOWN_QUALITY = { quality: { id: 0, name: 'Unknown', source: 'unknown', resolution: 0 }, revision: { version: 1, real: 0, isRepack: false } };
const UNKNOWN_LANGUAGES = [{ id: 0, name: 'Unknown' }];
const CHUNK = 5; // files per POST manualimport; each one is probed for media info

const list = (x) => (Array.isArray(x) ? x : []);
const nameOf = (p) => String(p || '').split(/[\\/]/).pop();
const reasons = (c) => list(c && c.rejections).map((r) => (r && r.reason) || '').filter(Boolean);
const codes = (f) => list(f.episodes).map((e) => episodeCode(e.seasonNumber ?? f.seasonNumber ?? 0, e.episodeNumber)).join(', ') || nameOf(f.path);

// True when `path` is inside `folder` (not the folder itself).
export function isInside(path, folder) {
  const f = pathKey(folder || '');
  return !!f && pathKey(path || '').startsWith(`${f}/`);
}

// The video files to ask about: from `files` (path, relativePath) or a
// listing of `folder`, without samples, extras, files in `inUse`, and (with
// `season`) files whose names say another season.
async function candidatePaths(arr, { folder, files, inUse, season = null }) {
  const listed = files || await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(folder)}`);
  const seen = new Set();
  const out = [];
  for (const f of list(listed)) {
    const path = f && f.path;
    if (!path || seen.has(pathKey(path)) || inUse.has(pathKey(path))) continue;
    const rel = f.relativePath || (isInside(path, folder) ? String(path).slice(String(folder).replace(/[\\/]+$/, '').length + 1) : nameOf(path));
    if (!isEpisodeFile(rel)) continue;
    if (season != null) { const n = episodeNumbers(rel); if (!n || n.season !== Number(season)) continue; }
    seen.add(pathKey(path));
    out.push(path);
  }
  return out;
}

// POST manualimport for each file, for this series or movie. With no episodes
// given, Sonarr matches the file to episodes itself, as its Manual Import does.
async function evaluate(arr, kind, item, paths, onProgress = () => {}) {
  // Sonarr 4 returns the release group it was sent (Sonarr 5 and Radarr fill
  // it in), so read it the way Sonarr parses the file first.
  const groups = new Map();
  if (kind === 'series') {
    await pool(paths, 4, async (p) => {
      try {
        const r = await arr.get(`parse?title=${encodeURIComponent(nameOf(p).replace(/\.[^.]+$/, ''))}&path=${encodeURIComponent(p)}`);
        const g = r && r.parsedEpisodeInfo && r.parsedEpisodeInfo.releaseGroup;
        if (g) groups.set(p, g);
      } catch { /* no release group */ }
    });
  }
  const ask = (p, id) => ({
    id, path: p,
    ...(kind === 'series' ? { seriesId: item.id, seasonNumber: null, episodeIds: [] } : { movieId: item.id }),
    quality: UNKNOWN_QUALITY, languages: UNKNOWN_LANGUAGES, releaseGroup: groups.get(p) || '', indexerFlags: 0,
  });
  const chunks = [];
  for (let i = 0; i < paths.length; i += CHUNK) chunks.push(paths.slice(i, i + CHUNK));
  const found = new Map();
  let done = 0;
  await pool(chunks, 2, async (chunk) => {
    let got = null;
    try { got = list(await arr.post('manualimport', chunk.map((p, j) => ask(p, j + 1)))); } catch { got = null; }
    if (got && got.length === chunk.length) chunk.forEach((p, j) => found.set(p, got[j]));
    else {
      // One file Sonarr can't read fails the whole request: ask one by one.
      for (const p of chunk) {
        try { const [it] = list(await arr.post('manualimport', [ask(p, 1)])); if (it) found.set(p, it); }
        catch (e) { found.set(p, { path: p, episodes: [], rejections: [{ reason: `Couldn’t read this file (${e.message})` }], unreadable: true }); }
      }
    }
    done += chunk.length;
    onProgress({ done, total: paths.length });
  });
  return paths.map((p) => ({ ...(found.get(p) || { episodes: [], rejections: [{ reason: 'No answer for this file' }], unreadable: true }), path: p }));
}

// Radarr: the files in the other folder, best first, against the movie's
// current file, with Radarr's own rejections, and whether a Recycle Bin is set.
export async function prepareKeepCopy(arr, { item, folder, files = null, onProgress } = {}) {
  const [movieFiles, mm] = await Promise.all([
    arr.get(`moviefile?movieId=${encodeURIComponent(item.id)}`).catch(() => []),
    arr.get('config/mediamanagement').catch(() => ({})),
  ]);
  const current = list(movieFiles)[0] || item.movieFile || null;
  const inUse = new Set(list(movieFiles).map((f) => f.path && pathKey(f.path)).filter(Boolean));
  const paths = await candidatePaths(arr, { folder, files, inUse });
  const evaluated = paths.length ? await evaluate(arr, 'movie', item, paths, onProgress) : [];
  const candidates = evaluated
    .map((c) => ({ ...c, movie: c.movie && c.movie.id ? c.movie : { id: item.id, title: item.title, year: item.year } }))
    .sort((a, b) => (a.unreadable === true) - (b.unreadable === true) || RANK(b.quality) - RANK(a.quality) || (b.size || 0) - (a.size || 0));
  const best = candidates.find((c) => !c.unreadable) || null;
  // Radarr's reprocess answer has no size: read it from the folder listing.
  if (best && !best.size) {
    try {
      const r = await arr.get(`filesystem?path=${encodeURIComponent(listingArg(splitPath(best.path).parent))}&includeFiles=true&allowFoldersWithoutTrailingSlashes=true`);
      const hit = list(r && r.files).find((f) => f && f.path && pathKey(f.path) === pathKey(best.path));
      if (hit && Number(hit.size) > 0) best.size = Number(hit.size);
    } catch { /* size stays unknown */ }
  }
  const rejections = best ? reasons(best) : [];
  return {
    current,
    candidates,
    best,
    rejections,
    recycleBin: (mm && mm.recycleBin) || '',
    better: !!(best && (!current || RANK(best.quality) > RANK(current.quality))),
    notUpgrade: rejections.some((r) => /not an upgrade/i.test(r)),
  };
}

// Sonarr, per episode: each file against the current file of the episode(s)
// Sonarr matches it to. season: only files whose names say that season. The
// show's own folder can be the source too: files Sonarr uses are left out.
// `pick` rows (clean upgrades, one file per episode) are preselected.
export async function prepareKeepCopySeries(arr, { item, folder, season = null, files = null, onProgress } = {}) {
  const [tracked, mm, naming] = await Promise.all([
    arr.get(`episodefile?seriesId=${encodeURIComponent(item.id)}`).catch(() => []),
    arr.get('config/mediamanagement').catch(() => ({})),
    arr.get('config/naming').catch(() => ({})),
  ]);
  const fileById = new Map(list(tracked).map((f) => [f.id, f]));
  const inUse = new Set(list(tracked).map((f) => f.path && pathKey(f.path)).filter(Boolean));
  const paths = await candidatePaths(arr, { folder, files, inUse, season });
  const evaluated = paths.length ? await evaluate(arr, 'series', item, paths, onProgress) : [];
  const first = (r) => (r.file.episodes[0] || {}).episodeNumber || 0;
  const rows = evaluated.map((c) => {
    const episodes = list(c.episodes);
    const current = episodes.map((e) => e.episodeFileId && fileById.get(e.episodeFileId)).find(Boolean) || null;
    const why = reasons(c);
    const notUpgrade = why.some((r) => /not an upgrade|not a custom format upgrade/i.test(r));
    const importable = episodes.length > 0 && !c.unreadable;
    const better = importable && !notUpgrade && (!current || RANK(c.quality) > RANK(current.quality));
    return {
      file: { ...c, episodes, seasonNumber: c.seasonNumber ?? (episodes[0] || {}).seasonNumber, series: { id: item.id, title: item.title } },
      current, better, missingNow: importable && !current, notUpgrade, rejections: why, importable, inFolder: isInside(c.path, item.path), pick: false,
    };
  }).sort((a, b) => (a.file.seasonNumber ?? 9999) - (b.file.seasonNumber ?? 9999) || first(a) - first(b) || RANK(b.file.quality) - RANK(a.file.quality));
  const taken = new Set();
  for (const r of rows) {
    const ids = r.file.episodes.map((e) => e.id);
    if (!r.better || r.rejections.length || ids.some((id) => taken.has(id))) continue;
    ids.forEach((id) => taken.add(id));
    r.pick = true;
  }
  return { rows, recycleBin: (mm && mm.recycleBin) || '', renameEpisodes: !!(naming && naming.renameEpisodes) };
}

// Which file each episode uses, for the seasons of `files`.
async function episodeFileIds(arr, item, files) {
  const seasons = [...new Set(files.map((f) => f.seasonNumber ?? (list(f.episodes)[0] || {}).seasonNumber).filter((s) => s != null))];
  const out = new Map();
  await pool(seasons, 2, async (s) => {
    const eps = await arr.get(`episode?seriesId=${encodeURIComponent(item.id)}&seasonNumber=${encodeURIComponent(s)}`);
    for (const e of list(eps)) out.set(e.id, e.episodeFileId || 0);
  });
  return out;
}

// Imports the chosen files (Manual Import, move) and finishes in-folder ones.
// Returns which episodes were imported or not, the old files deleted, the
// ones kept because another episode still uses them, and any problems.
export async function runKeepCopySeries(arr, { item, files, renameEpisodes = false, ...rest }) {
  if (!files.length) throw new Error('Choose at least one episode');
  const before = await episodeFileIds(arr, item, files).catch(() => new Map());
  for (const f of files) for (const e of list(f.episodes)) if (!before.has(e.id)) before.set(e.id, e.episodeFileId || 0);
  const command = await runCommand(arr, buildImportCommand('series', files, { importMode: 'move' }), 'Sonarr', rest);

  const sid = encodeURIComponent(item.id);
  const [after, now] = await Promise.all([episodeFileIds(arr, item, files), arr.get(`episodefile?seriesId=${sid}`).then(list)]);
  const byPath = new Map(now.map((f) => [pathKey(f.path || ''), f]));
  const byId = new Map(now.map((f) => [f.id, f]));
  const used = new Set([...after.values()].filter(Boolean));
  const result = { command, imported: [], missed: [], removed: [], kept: [], renamed: 0, problems: [] };
  const newInPlace = [];
  const oldIds = new Set();
  for (const f of files) {
    const ids = list(f.episodes).map((e) => e.id);
    if (isInside(f.path, item.path)) {
      // Imported where it is: the episodes now point at a file with this path.
      const nf = byPath.get(pathKey(f.path));
      if (!nf || !ids.length || !ids.every((id) => after.get(id) === nf.id)) { result.missed.push(codes(f)); continue; }
      result.imported.push(codes(f));
      newInPlace.push(nf.id);
      for (const id of ids) { const old = before.get(id); if (old && old !== nf.id) oldIds.add(old); }
    } else {
      const ok = ids.length && ids.every((id) => after.get(id) && after.get(id) !== before.get(id));
      (ok ? result.imported : result.missed).push(codes(f));
    }
  }
  // Sonarr keeps the file it used before an in-folder import. Delete it through
  // Sonarr (its Recycle Bin if set), unless an episode still uses it.
  for (const old of oldIds) {
    const f = byId.get(old);
    if (!f) continue;
    const where = f.path || f.relativePath || `file ${old}`;
    if (used.has(old)) { result.kept.push(where); continue; }
    try { await arr.del(`episodefile/${old}`); result.removed.push(where); }
    catch (e) { result.problems.push(`Couldn’t delete ${nameOf(where)}: ${e.message}`); }
  }
  // Sonarr renames the files it moves in; rename the in-folder ones too.
  if (renameEpisodes && newInPlace.length) {
    try { await runCommand(arr, { name: 'RenameFiles', seriesId: item.id, files: newInPlace }, 'Sonarr', rest); result.renamed = newInPlace.length; }
    catch (e) { result.problems.push(`Couldn’t rename the new files: ${e.message}`); }
  }
  result.now = list(await arr.get(`episodefile?seriesId=${sid}`).catch(() => now));
  return result;
}

// Imports `file` for the movie (move mode) and waits for Radarr to finish.
export async function runKeepCopy(arr, { item, file, ...rest }) {
  const command = await runCommand(arr, buildImportCommand('movie', [{ ...file, movie: file.movie || { id: item.id } }], { importMode: 'move' }), 'Radarr', rest);
  const now = await arr.get(`moviefile?movieId=${encodeURIComponent(item.id)}`).catch(() => []);
  return { command, now: list(now)[0] || null };
}

// Starts a command and waits for it; throws unless it completed.
async function runCommand(arr, body, app, { wait = 1000, timeoutMs = 120000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const cmd = await arr.post('command', body);
  const started = Date.now();
  let state = cmd;
  while (commandOutcome(state) === 'pending' && Date.now() - started < timeoutMs) {
    await sleep(wait);
    state = await arr.get(`command/${cmd.id}`);
  }
  const outcome = commandOutcome(state);
  if (outcome !== 'completed') throw new Error(outcome === 'failed' ? (state.message || `${app} reported the ${body.name === 'RenameFiles' ? 'rename' : 'import'} failed`) : `${app} is still working on it; check Activity in a minute`);
  return state;
}
