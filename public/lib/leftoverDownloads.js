// "Untracked files", part 2: downloads left in a root folder next to the
// shows and movies (an episode or season download in tv2, a release folder in
// movie2, a loose video). Each one is checked with the app's own Manual Import
// from the folder, as Manual Import (Wanted → Missing) does, and sorted:
//   missing   - the library has no file for it: import it (moved in, renamed)
//   upgrade   - better than the copy in use: import it (the old file goes to
//               the Recycle Bin, as with any upgrade)
//   redundant - the same as, or worse than, the copy in use: listed and
//               exported, never deleted
//   unknown   - a show or movie the app doesn't have
//   unmatched - the app can't tell which episode it is
//   blocked   - another reason from the app
// Network side and pure helpers; the dialog is untrackedUI.js.
import { pool } from './pathScan.js';
import { pathKey, listingArg } from './pathDoctor.js';
import { isEpisodeFile, episodeCode } from './episodeDupes.js';
import { parseFolder } from './existingFolders.js';
import { buildImportCommand } from './manualImport.js';
import { waitForCommand } from './existingFoldersScan.js';

const list = (x) => (Array.isArray(x) ? x : []);
const nameOf = (p) => String(p || '').split(/[\\/]/).pop();
const VIDEO = /\.(?:mkv|mp4|m4v|avi|ts|m2ts|mov|wmv|mpg|mpeg|webm|divx|vob|iso)$/i;
const RELEASE = /(?:^|[^a-z0-9])(?:2160|1080|720|576|480)[pi](?![a-z0-9])|(?:^|[^a-z0-9])(?:web-?dl|webrip|bluray|blu-ray|bdrip|brrip|hdtv|dvdrip|remux|x26[45]|h\.?26[45]|hevc)(?![a-z0-9])/i;
const NOT_UPGRADE = /not an upgrade|not a custom format upgrade/i;
const UNKNOWN = /unknown (?:series|movie)/i;

// Pure: a folder in a root folder that looks like a download, not a show or
// movie folder: episode, season and whole-series downloads, failed ones, and
// release-named folders ("Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GRP").
export function isLeftoverFolder(name, kind) {
  const p = parseFolder(name, kind);
  if (p.kind === 'system') return false;
  if (['episode', 'season', 'pack', 'failed', 'collection'].includes(p.kind)) return true;
  return RELEASE.test(String(name));
}

// The folders and loose videos to check, from each root folder.
export async function leftoverCandidates(arr, { kind } = {}) {
  const roots = list(await arr.get('rootfolder')).filter((r) => r && r.path);
  const out = [];
  await pool(roots.filter((r) => r.accessible !== false), 2, async (r) => {
    let full = r;
    try { full = (await arr.get(`rootfolder/${encodeURIComponent(r.id)}?timeout=false`)) || r; } catch { full = r; }
    for (const f of list(full.unmappedFolders)) if (f && f.path && isLeftoverFolder(f.name || nameOf(f.path), kind)) out.push({ root: r.path, path: f.path, name: f.name || nameOf(f.path), type: 'folder' });
    try {
      const d = await arr.get(`filesystem?path=${encodeURIComponent(listingArg(r.path))}&includeFiles=true&allowFoldersWithoutTrailingSlashes=true`);
      for (const f of list(d && d.files)) {
        const name = (f && (f.name || nameOf(f.path))) || '';
        if (f && f.path && VIDEO.test(name) && isEpisodeFile(name)) out.push({ root: r.path, path: f.path, name, type: 'file', size: Number(f.size) || 0 });
      }
    } catch { /* root folder not listed */ }
  });
  out.sort((a, b) => a.root.localeCompare(b.root) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { roots, candidates: out };
}

// Pure: what one manual-import answer means.
export function classifyLeftover(it, kind) {
  const why = list(it && it.rejections).map((x) => x && x.reason).filter(Boolean);
  const owner = kind === 'series' ? it && it.series : it && it.movie;
  const episodes = list(it && it.episodes);
  const codes = episodes.map((e) => episodeCode(e.seasonNumber ?? it.seasonNumber ?? 0, e.episodeNumber)).join(', ');
  const title = owner ? `${owner.title || ''}${owner.year ? ` (${owner.year})` : ''}` : '';
  if (!owner || why.some((x) => UNKNOWN.test(x))) return { cls: 'unknown', why, codes, title };
  if (kind === 'series' && !episodes.length) return { cls: 'unmatched', why, codes, title };
  if (why.some((x) => NOT_UPGRADE.test(x))) return { cls: 'redundant', why, codes, title };
  if (why.length) return { cls: 'blocked', why, codes, title };
  const has = kind === 'series' ? episodes.some((e) => e.hasFile || e.episodeFileId) : !!(owner.hasFile || owner.movieFile || owner.movieFileId);
  return { cls: has ? 'upgrade' : 'missing', why, codes, title };
}

// Asks the app about each candidate (two at a time: it reads each file's
// media info). Fills candidate.items with { cls, why, codes, title, item }.
// shouldStop(): stop before the next one.
export async function checkLeftovers(arr, candidates, { kind, concurrency = 2, onProgress = () => {}, shouldStop = () => false } = {}) {
  let done = 0;
  await pool(candidates, concurrency, async (c) => {
    if (c.status === 'checked') { done += 1; return; }
    if (shouldStop()) { c.status = c.status || 'waiting'; return; }
    c.status = 'checking';
    try {
      const items = list(await arr.get(`manualimport?folder=${encodeURIComponent(c.path)}&filterExistingFiles=true`));
      c.items = items.filter((it) => it && it.path && isEpisodeFile(nameOf(it.path))).map((it) => ({ ...classifyLeftover(it, kind), item: it, candidate: c }));
      c.status = 'checked';
    } catch (e) { c.status = 'error'; c.error = e.message; c.items = []; }
    onProgress({ done: ++done, total: candidates.length, candidate: c });
  });
  return candidates;
}

export const LEFTOVER_CLASSES = ['missing', 'upgrade', 'redundant', 'unknown', 'unmatched', 'blocked'];
export function leftoverSummary(candidates) {
  const by = Object.fromEntries(LEFTOVER_CLASSES.map((k) => [k, { files: 0, bytes: 0, folders: new Set() }]));
  const imported = { files: 0, bytes: 0 };
  for (const c of candidates) for (const x of list(c.items)) {
    if (x.imported) { imported.files += 1; imported.bytes += Number(x.item.size) || 0; continue; }
    const b = by[x.cls]; if (!b) continue;
    b.files += 1; b.bytes += Number(x.item.size) || 0; b.folders.add(c.path);
  }
  // A folder is redundant only when every video in it is.
  const redundantFolders = candidates.filter((c) => list(c.items).length && c.items.every((x) => x.cls === 'redundant'));
  return { by, imported, redundantFolders, checked: candidates.filter((c) => c.status === 'checked').length, errors: candidates.filter((c) => c.status === 'error').length };
}

// Imports the chosen files (Manual Import, move: the app moves each one into
// the show's or movie's folder and renames it; an upgrade sends the old file
// to its Recycle Bin). picks: [{ item, candidate }]. Returns the paths that
// are gone from where they were (imported).
export async function importLeftovers(arr, picks, { kind, wait = 1000, chunk = 20, onProgress = () => {} } = {}) {
  const moved = new Set();
  const failed = [];
  for (let i = 0; i < picks.length; i += chunk) {
    const part = picks.slice(i, i + chunk);
    try {
      const cmd = await arr.post('command', buildImportCommand(kind, part.map((p) => p.item), { importMode: 'move' }));
      const outcome = await waitForCommand(arr, cmd, { wait, timeoutMs: 600000 });
      if (outcome === 'failed') failed.push(...part.map((p) => p.item.path));
    } catch (e) { failed.push(...part.map((p) => p.item.path)); }
    // Which files left: list each folder (or root, for loose files) again.
    const placeOf = (c) => (c.type === 'file' ? c.root : c.path);
    const places = new Map();
    for (const p of part) if (!places.has(placeOf(p.candidate))) places.set(placeOf(p.candidate), p.candidate);
    const still = new Set(); const unknown = new Set();
    await pool([...places.values()], 3, async (c) => {
      try {
        if (c.type === 'file') { const d = await arr.get(`filesystem?path=${encodeURIComponent(listingArg(c.root))}&includeFiles=true&allowFoldersWithoutTrailingSlashes=true`); for (const f of list(d && d.files)) still.add(pathKey(f.path)); }
        else for (const f of list(await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(c.path)}`))) still.add(pathKey(f.path));
      } catch { unknown.add(placeOf(c)); }
    });
    for (const p of part) if (!unknown.has(placeOf(p.candidate)) && !still.has(pathKey(p.item.path))) moved.add(p.item.path);
    onProgress({ done: Math.min(i + chunk, picks.length), total: picks.length });
  }
  return { moved, failed };
}

export const LEFTOVER_CSV_HEADERS = ['Root folder', 'Download', 'File', 'Size (bytes)', 'Status', 'Show or movie', 'Episodes', 'Quality', 'Reason'];
export const LEFTOVER_LABEL = {
  missing: 'Missing from the library',
  upgrade: 'Better than the copy in use',
  redundant: 'Redundant (the same or worse)',
  unknown: 'Not in the library',
  unmatched: 'Episode not recognised',
  blocked: 'Won’t import',
};
export function leftoverCsvRows(candidates) {
  const rows = [];
  for (const c of candidates) {
    if (c.status !== 'checked') { rows.push([c.root, c.name, '', '', c.status === 'error' ? `Couldn’t check: ${c.error}` : 'Not checked', '', '', '', '']); continue; }
    if (!list(c.items).length) rows.push([c.root, c.name, '', '', 'No video files', '', '', '', '']);
    for (const x of list(c.items)) rows.push([c.root, c.name, x.item.path, Number(x.item.size) || '', x.imported ? 'Imported' : LEFTOVER_LABEL[x.cls], x.title, x.codes, (x.item.quality && x.item.quality.quality && x.item.quality.quality.name) || '', x.why.join('; ')]);
  }
  return rows;
}
// The folder (or loose file) of each redundant download, one per line.
export function redundantPaths(candidates) {
  return leftoverSummary(candidates).redundantFolders.map((c) => c.path).concat(
    candidates.filter((c) => c.type === 'file' && list(c.items).some((x) => x.cls === 'redundant')).map((c) => c.path),
  ).filter((p, i, a) => a.indexOf(p) === i);
}
