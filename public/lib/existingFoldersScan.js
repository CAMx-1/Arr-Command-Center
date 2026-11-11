// Network side of "Add existing folders" (no DOM): read the folders Sonarr or
// Radarr doesn't manage, look each one up, and add the chosen ones.
import { pool } from './pathScan.js';
import { pathKey } from './pathDoctor.js';
import { commandOutcome } from './manualImport.js';
import { qualityFromName, isEpisodeFile } from './episodeDupes.js';
import {
  parseFolder, lookupTerm, matchFolder, choose, sameTitleGroups, holdsLibraryItems, libraryAncestors, rootDefaults, addPayload, titleKeyOf,
} from './existingFolders.js';

const itemsPath = (kind) => (kind === 'series' ? 'series' : 'movie');
const list = (x) => (Array.isArray(x) ? x : []);

// Root folders, their folders that no entry uses (the full list: the plain
// root folder list gives up after 5 s on a big folder), sorted into the ones
// to look up and the ones that aren't titles. hidden: Set(pathKey).
export async function readExistingFolders(arr, { kind, hidden = new Set(), onProgress = () => {} } = {}) {
  const [roots, items, profiles] = await Promise.all([
    arr.get('rootfolder').then(list),
    arr.get(itemsPath(kind)).then(list),
    arr.get('qualityprofile').then(list).catch(() => []),
  ]);
  // The first entry wins when the app has the same title twice.
  const library = new Map();
  for (const it of items) { const id = kind === 'series' ? it.tvdbId : it.tmdbId; if (id && !library.has(id)) library.set(id, it); }
  const rows = []; const skipped = []; const usedRoots = [];
  const holders = libraryAncestors(items);
  let done = 0;
  await pool(roots, 2, async (r) => {
    let full = r;
    if (r.accessible !== false) {
      try { full = (await arr.get(`rootfolder/${encodeURIComponent(r.id)}?timeout=false`)) || r; } catch { full = r; }
    }
    onProgress({ stage: 'roots', done: ++done, total: roots.length });
    const folders = list(full.unmappedFolders);
    if (r.accessible === false) return;
    usedRoots.push(r);
    for (const f of folders) {
      const folder = { name: f.name, path: f.path, root: r.path, rootId: r.id };
      const parsed = parseFolder(f.name, kind);
      if (hidden.has(pathKey(f.path))) skipped.push({ folder, reason: 'hidden', parsed });
      else if (parsed.kind !== 'title' && parsed.kind !== 'pack') skipped.push({ folder, reason: parsed.kind, parsed });
      else if (holdsLibraryItems(f.path, holders)) skipped.push({ folder, reason: 'holds', parsed });
      else rows.push({ folder, parsed, videos: null, match: null, status: 'new' });
    }
  });
  // Video files in each folder (Sonarr's own scan rules): empty folders and
  // folders with only extras aren't offered.
  let counted = 0;
  await pool(rows, 4, async (row) => {
    try { row.videos = list(await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(row.folder.path)}`)).length; } catch { row.videos = null; }
    onProgress({ stage: 'videos', done: ++counted, total: rows.length });
  });
  const keep = [];
  for (const row of rows) { if (row.videos === 0) skipped.push({ folder: row.folder, reason: 'no-videos', parsed: row.parsed }); else keep.push(row); }
  const byName = (a, b) => a.folder.root.localeCompare(b.folder.root) || a.folder.name.localeCompare(b.folder.name, undefined, { sensitivity: 'base' });
  const defaults = new Map(usedRoots.map((r) => [r.path, rootDefaults(r.path, items, profiles, kind)]));
  return { rows: keep.sort(byName), skipped: skipped.sort(byName), roots: usedRoots, items, library, profiles, defaults };
}

// Looks each row up (two at a time, as Sonarr's own Library Import is gentle
// with its metadata server), calling onRow as each one is matched.
export async function lookUpRows(arr, rows, { kind, library, onRow = () => {} } = {}) {
  await pool(rows, 2, async (row) => lookUpRow(arr, row, { kind, library, onRow }));
  markSameTitles(rows, kind);
}
export async function lookUpRow(arr, row, { kind, library, term = null, onRow = () => {} } = {}) {
  row.status = 'looking';
  const q = term || lookupTerm(row.parsed, kind);
  try {
    const results = list(await arr.get(`${itemsPath(kind)}/lookup?term=${encodeURIComponent(q)}`));
    row.match = matchFolder(term ? { ...row.parsed, title: term, year: null } : row.parsed, results, kind, library);
    row.status = 'matched';
  } catch (e) {
    row.match = { pick: null, confidence: 'none', why: `Lookup failed: ${e.message}`, choices: [], existing: null };
    row.status = 'matched';
  }
  row.term = q;
  onRow(row);
  return row;
}
export function pickChoice(row, pick, { kind, library }) { row.match = choose(row.match, pick, kind, library); return row; }
export function markSameTitles(rows, kind) {
  const sameAs = sameTitleGroups(rows.filter((r) => r.match && r.status !== 'added'), kind);
  for (const r of rows) r.sameAs = sameAs.get(r.folder.path) || null;
}

// Rows that can be added, and whether each starts ticked: a clean match,
// not in the app yet, not another folder for a title already in the list.
export const canAdd = (row) => !!(row.match && row.match.pick && !row.match.existing && row.status !== 'added');
export const tickedByDefault = (row) => canAdd(row) && !row.sameAs && ['exact', 'likely', 'picked'].includes(row.match.confidence);

// Adds rows one at a time (a failure doesn't stop the rest). settingsFor(row)
// returns { qualityProfileId, monitor, seasonFolder | minimumAvailability }.
export async function addRows(arr, rows, { kind, settingsFor, onProgress = () => {} } = {}) {
  const added = []; const failed = [];
  let done = 0;
  for (const row of rows) {
    try {
      const res = await arr.post(itemsPath(kind), addPayload(kind, row.match.pick, row.folder, settingsFor(row)));
      row.status = 'added'; row.added = res; row.error = null;
      added.push(row);
    } catch (e) {
      row.status = 'failed'; row.error = e.message || 'Failed';
      failed.push(row);
    }
    onProgress({ done: ++done, total: rows.length, row });
  }
  return { added, failed };
}

// ------------------------------------------------- after adding: the files
// Sonarr and Radarr read a new folder themselves, but skip files they can't
// parse: Radarr needs a year in the folder or file name ("Juno/Juno.mkv" stays
// missing), Sonarr needs episode numbers. Movies are linked here with Radarr's
// Manual Import, where the file is (nothing moved or renamed); episode files
// are only counted, since matching them needs a person.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(arr, cmd, { wait = 1000, timeoutMs = 60000 } = {}) {
  let state = cmd; const start = Date.now();
  while (commandOutcome(state) === 'pending' && Date.now() - start < timeoutMs) { await sleep(wait); state = await arr.get(`command/${cmd.id}`); }
  return commandOutcome(state);
}
// Radarr's quality for a file with nothing in its name: the same fallback it
// uses (by extension: .mkv WEBDL-720p, .m2ts Bluray-720p, .avi/.mp4 SDTV).
const EXT_QUALITY = { mkv: 'WEBDL-720p', mk3d: 'WEBDL-720p', m2ts: 'Bluray-720p', iso: 'DVD', vob: 'DVD', img: 'DVD' };
export function movieQualityFor(name, definitions) {
  const defs = list(definitions).map((d) => d.quality).filter(Boolean);
  const byName = (n) => defs.find((q) => q.name === n);
  const g = qualityFromName(name);
  const source = { remux: 'Remux', bluray: 'Bluray', webdl: 'WEBDL', webrip: 'WEBRip', hdtv: 'HDTV', dvd: 'DVD' }[g.source];
  const res = g.resolution === 2160 ? '2160p' : g.resolution === 1080 ? '1080p' : g.resolution === 720 ? '720p' : g.resolution ? '480p' : '';
  const guess = source === 'DVD' ? byName('DVD') : source && res ? byName(source === 'Remux' ? `Remux-${res}` : `${source}-${res}`) : res ? byName(`WEBDL-${res}`) : null;
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1];
  return guess || byName(EXT_QUALITY[String(ext).toLowerCase()] || 'SDTV') || defs[0] || { id: 0, name: 'Unknown' };
}

// A video named for this movie: its title (any of the lookup's titles) and
// nothing else, so "American Pie 2.avi" isn't linked to American Pie.
export function fileIsMovie(fileName, pick) {
  const p = parseFolder(String(fileName).replace(/\.[^.]+$/, ''), 'movie');
  if (!p.title) return false;
  const t = titleKeyOf(p.title);
  const names = [pick.title, pick.originalTitle, ...((pick.alternateTitles || []).map((a) => a && a.title))].filter(Boolean).map((x) => titleKeyOf(String(x).replace(/\s*\((?:19|20)\d\d\)\s*$/, '')));
  return names.includes(t) && (!p.year || !pick.year || Math.abs(p.year - pick.year) <= 1);
}

// added: rows from addRows. Returns { linked, unread, checked }: movies linked
// to their file here, and items whose files the app still hasn't read.
// link: false (a role that can't run Manual Import) only lists the files.
export async function linkAddedFiles(arr, added, { kind, wait = 1000, settle = 4000, link = true, onProgress = () => {} } = {}) {
  const out = { linked: [], unread: [], checked: 0 };
  if (!added.length) return out;
  const ids = added.map((r) => r.added && r.added.id).filter(Boolean);
  // The app refreshes and scans each one it adds; ask once more for all of
  // them and wait, so the counts below are final.
  try {
    const cmd = await arr.post('command', kind === 'series' ? { name: 'RefreshSeries', seriesIds: ids } : { name: 'RefreshMovie', movieIds: ids });
    await waitFor(arr, cmd, { wait, timeoutMs: 120000 });
  } catch { await sleep(settle); }
  const defs = kind === 'movie' ? await arr.get('qualitydefinition').catch(() => []) : [];
  const toLink = []; // { row, id, pick, quality }
  let done = 0;
  for (const row of added) {
    onProgress({ done: ++done, total: added.length, row });
    const id = row.added && row.added.id;
    if (!id) continue;
    out.checked += 1;
    const videos = list(await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(row.folder.path)}`).catch(() => [])).filter((f) => isEpisodeFile(f.relativePath || f.name || f.path));
    if (kind === 'series') {
      const files = list(await arr.get(`episodefile?seriesId=${encodeURIComponent(id)}`).catch(() => []));
      const known = new Set(files.map((f) => pathKey(f.path || '')));
      const unread = videos.filter((v) => !known.has(pathKey(v.path)));
      if (unread.length) out.unread.push({ row, files: unread.map((v) => v.path) });
      continue;
    }
    const files = list(await arr.get(`moviefile?movieId=${encodeURIComponent(id)}`).catch(() => []));
    if (files.length || !videos.length) continue;
    // The biggest video is the film (samples and extras are already left out).
    let pick = videos[0];
    if (videos.length > 1) {
      const sized = await arr.get(`filesystem?path=${encodeURIComponent(`${row.folder.path.replace(/[\\/]+$/, '')}/`)}&includeFiles=true&allowFoldersWithoutTrailingSlashes=true`).catch(() => null);
      const size = new Map(list(sized && sized.files).map((f) => [pathKey(f.path), Number(f.size) || 0]));
      pick = [...videos].sort((a, b) => (size.get(pathKey(b.path)) || 0) - (size.get(pathKey(a.path)) || 0))[0];
    }
    const name = String(pick.name || pick.path).split(/[\\/]/).pop();
    if (!row.match || !row.match.pick || !fileIsMovie(name, row.match.pick)) { out.unread.push({ row, files: [pick.path], reason: 'name' }); continue; }
    if (!link) { out.unread.push({ row, files: [pick.path], reason: 'role' }); continue; }
    toLink.push({ row, id, pick, quality: movieQualityFor(name, defs) });
  }
  if (!toLink.length) return out;
  // One Manual Import for all of them. A file inside the movie's own folder is
  // recorded where it is: not moved, not renamed.
  try {
    const cmd = await arr.post('command', { name: 'ManualImport', importMode: 'auto', files: toLink.map((x) => ({ path: x.pick.path, folderName: x.row.folder.name, movieId: x.id, quality: { quality: x.quality, revision: { version: 1, real: 0, isRepack: false } }, languages: [(x.row.match.pick.originalLanguage) || { id: 1, name: 'English' }], releaseGroup: '', indexerFlags: 0 })) });
    await waitFor(arr, cmd, { wait, timeoutMs: 300000 });
  } catch { /* checked below */ }
  await pool(toLink, 4, async (x) => {
    const now = list(await arr.get(`moviefile?movieId=${encodeURIComponent(x.id)}`).catch(() => []));
    if (now.length) out.linked.push({ row: x.row, file: x.pick.path, quality: x.quality.name });
    else out.unread.push({ row: x.row, files: [x.pick.path] });
  });
  return out;
}

export const FOLDER_CSV_HEADERS = ['Root folder', 'Folder', 'Videos', 'Status', 'Match', 'Year', 'Confidence', 'Note'];
export function folderCsvRows(rows, skipped, { app, reasons }) {
  const out = rows.map((r) => {
    const p = r.match && r.match.pick;
    const status = r.status === 'added' ? 'Added' : r.status === 'failed' ? `Failed: ${r.error}` : r.match && r.match.existing ? `Already in ${app}` : r.sameAs ? 'Another folder for the same title' : p ? 'Can be added' : 'No match';
    return [r.folder.root, r.folder.name, r.videos ?? '', status, p ? p.title : '', p ? p.year || '' : '', r.match ? r.match.confidence : '', (r.match && r.match.existing && r.match.existing.path) || r.sameAs || (r.match && r.match.why) || ''];
  });
  for (const s of skipped) out.push([s.folder.root, s.folder.name, '', `Not offered: ${reasons[s.reason] || s.reason}`, '', '', '', '']);
  return out;
}
