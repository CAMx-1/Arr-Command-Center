// "Untracked files", part 1: videos inside a show's or movie's own folder
// that Sonarr or Radarr doesn't track (the Dexter case: seasons 2, 4 and 6
// tracked, seasons 1, 3, 5, 7 and 8 sitting in the same folder). The fix is
// the app's own rescan, which records files where they are (nothing is moved
// or renamed); files it still won't take are explained with its own import
// check. Network side and pure helpers; the dialog is untrackedUI.js.
import { pool } from './pathScan.js';
import { pathKey, joinPath } from './pathDoctor.js';
import { isEpisodeFile, episodeNumbers, episodeCode } from './episodeDupes.js';
import { buildImportCommand } from './manualImport.js';
import { evaluateFiles } from './keepCopy.js';
import { fileIsMovie, movieQualityFor, linkMovieFiles, waitForCommand } from './existingFoldersScan.js';

const list = (x) => (Array.isArray(x) ? x : []);
const nameOf = (p) => String(p || '').split(/[\\/]/).pop();
// Blu-ray and DVD folder structures: the apps can't import these.
const DISC = /(?:^|[\\/])(?:BDMV|VIDEO_TS|HVDVD_TS)(?:[\\/]|$)/i;
const NOT_UPGRADE = /not an upgrade|not a custom format upgrade/i;

const trackedPath = (item, f) => pathKey(f.path || joinPath(item.path, String(f.relativePath || '')));

// Pure: the videos in one entry's folder that the app doesn't track.
// listed: filesystem/mediafiles; tracked: Set(pathKey) of the tracked files.
export function untrackedIn(kind, item, listed, tracked) {
  const base = String(item.path || '').replace(/[\\/]+$/, '');
  const files = []; let disc = 0;
  for (const f of list(listed)) {
    const path = f && f.path;
    if (!path) continue;
    const rel = f.relativePath || (path.toLowerCase().startsWith(`${base.toLowerCase()}`) ? path.slice(base.length + 1) : nameOf(path));
    if (tracked.has(pathKey(path))) continue;
    if (DISC.test(rel)) { disc += 1; continue; }
    if (!isEpisodeFile(rel)) continue;
    files.push({ path, rel, name: nameOf(path), numbers: kind === 'series' ? episodeNumbers(rel) : null });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true, sensitivity: 'base' }));
  return { item, files, disc, tracked: tracked.size };
}

// "Seasons 1, 3, 5, 7 and 8", "Season 2", "Specials".
export function seasonsText(files) {
  const seasons = [...new Set(list(files).map((f) => f.numbers && f.numbers.season).filter((n) => n != null))].sort((a, b) => a - b);
  const regular = seasons.filter((n) => n !== 0);
  const words = regular.length > 1 ? `Seasons ${regular.slice(0, -1).join(', ')} and ${regular[regular.length - 1]}` : regular.length ? `Season ${regular[0]}` : '';
  if (seasons.includes(0)) return words ? `${words}, and Specials` : 'Specials';
  return words;
}

// Every entry's folder, against the files the app tracks.
export async function scanUntracked(arr, { kind, onProgress = () => {}, max = 6000 } = {}) {
  const series = kind === 'series';
  const [items, mm] = await Promise.all([arr.get(series ? 'series' : 'movie').then(list), arr.get('config/mediamanagement').catch(() => null)]);
  const withPath = items.filter((it) => it && it.path).slice(0, max);
  const entries = []; let unreadable = 0; let done = 0;
  await pool(withPath, 4, async (it) => {
    try {
      const listed = list(await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(it.path)}`));
      const videos = listed.filter((f) => f && f.path && (isEpisodeFile(f.relativePath || f.name || f.path) || DISC.test(f.relativePath || f.path)));
      if (!videos.length) return;
      let tracked;
      if (series) {
        // The same number of videos as episode files: all tracked (saves a call per show).
        const count = (it.statistics && it.statistics.episodeFileCount) || 0;
        if (videos.length === count) return;
        tracked = new Set(list(await arr.get(`episodefile?seriesId=${encodeURIComponent(it.id)}`)).map((f) => trackedPath(it, f)));
      } else {
        const mf = it.movieFile;
        if (mf && videos.length === 1) return;
        tracked = new Set(mf ? [trackedPath(it, mf)] : []);
      }
      const e = untrackedIn(kind, it, listed, tracked);
      if (e.files.length || e.disc) entries.push(e);
    } catch { unreadable += 1; } finally { onProgress({ done: ++done, total: withPath.length }); }
  });
  entries.sort((a, b) => (b.files.length + b.disc) - (a.files.length + a.disc) || String(a.item.title).localeCompare(String(b.item.title)));
  return { entries, checked: withPath.length, unreadable, mm, rescanAfterRefresh: mm && mm.rescanAfterRefresh ? String(mm.rescanAfterRefresh) : null };
}

// The setting that makes new files in a show's or movie's folder go
// unnoticed: the app rescans folders after a refresh always (the default),
// only after a manual refresh, or never.
export function rescanSettingFinding(value, app) {
  const v = String(value || '').toLowerCase();
  if (!v || v === 'always') return null;
  return {
    value: v,
    title: v === 'never' ? `${app} never rescans folders after a refresh` : `${app} only rescans folders after a manual refresh`,
    detail: `New files put straight into a ${app === 'Radarr' ? 'movie' : 'show'}’s folder are only noticed when you rescan it yourself. The default is “Always”.`,
  };
}

// Asks the app to rescan each entry's folder, waits, then checks again.
// Returns the entries with their files still untracked, and how many were
// picked up.
export async function rescanAndRecheck(arr, kind, entries, { wait = 2000, timeoutMs = 15 * 60000, onProgress = () => {} } = {}) {
  const series = kind === 'series';
  const before = entries.reduce((n, e) => n + e.files.length, 0);
  const cmds = [];
  for (const e of entries) {
    try { cmds.push({ e, cmd: await arr.post('command', series ? { name: 'RescanSeries', seriesId: e.item.id } : { name: 'RescanMovie', movieId: e.item.id }) }); }
    catch (err) { cmds.push({ e, error: err.message }); }
  }
  let done = 0;
  await pool(cmds, 3, async (c) => {
    if (c.cmd) { try { c.outcome = await waitForCommand(arr, c.cmd, { wait, timeoutMs }); } catch (err) { c.outcome = 'failed'; c.error = err.message; } }
    onProgress({ stage: 'rescan', done: ++done, total: cmds.length });
  });
  // Check again.
  const after = []; let checked = 0;
  await pool(entries, 4, async (e) => {
    const it = e.item;
    try {
      const listed = list(await arr.get(`filesystem/mediafiles?path=${encodeURIComponent(it.path)}`));
      let tracked; let movie = it;
      if (series) tracked = new Set(list(await arr.get(`episodefile?seriesId=${encodeURIComponent(it.id)}`)).map((f) => trackedPath(it, f)));
      else {
        const files = list(await arr.get(`moviefile?movieId=${encodeURIComponent(it.id)}`));
        movie = { ...it, movieFile: files[0] || null, hasFile: files.length > 0 };
        tracked = new Set(files.map((f) => trackedPath(it, f)));
      }
      const next = untrackedIn(kind, movie, listed, tracked);
      next.before = e.files.length;
      if (next.files.length || next.disc) after.push(next);
    } catch { after.push({ ...e, before: e.files.length, error: true }); }
    onProgress({ stage: 'check', done: ++checked, total: entries.length });
  });
  after.sort((a, b) => (b.files.length + b.disc) - (a.files.length + a.disc) || String(a.item.title).localeCompare(String(b.item.title)));
  const left = after.reduce((n, e) => n + e.files.length, 0);
  return { entries: after, pickedUp: Math.max(0, before - left), failed: cmds.filter((c) => c.error || c.outcome === 'failed').length };
}

// Pure: why Sonarr won't take an episode file it was asked about.
//   import    - no rejection and the episode has no file: it can be added
//   better    - no rejection, but the episode has a file: an upgrade (Find duplicates)
//   copy      - "Not an upgrade": another file is used for the episode
//   unmatched - Sonarr can't tell which episode it is
//   blocked   - another reason from Sonarr
//   unreadable
export function classifyEpisodeFile(r) {
  const episodes = list(r && r.episodes);
  const why = list(r && r.rejections).map((x) => x && x.reason).filter(Boolean);
  const codes = episodes.map((e) => episodeCode(e.seasonNumber ?? r.seasonNumber ?? 0, e.episodeNumber)).join(', ');
  if (r && r.unreadable) return { kind: 'unreadable', codes, why };
  if (!episodes.length) return { kind: 'unmatched', codes, why };
  if (why.some((x) => NOT_UPGRADE.test(x))) return { kind: 'copy', codes, why };
  if (why.length) return { kind: 'blocked', codes, why };
  if (episodes.some((e) => e.episodeFileId || e.hasFile)) return { kind: 'better', codes, why };
  return { kind: 'import', codes, why };
}

// Sonarr: ask about each file still untracked in a show's folder.
export async function explainSeries(arr, entry, { onProgress } = {}) {
  const answers = await evaluateFiles(arr, 'series', entry.item, entry.files.map((f) => f.path), onProgress);
  return answers.map((r) => ({ file: entry.files.find((f) => f.path === r.path) || { path: r.path, name: nameOf(r.path) }, answer: r, ...classifyEpisodeFile(r) }));
}

// Pure (Radarr): what to do with a movie's untracked files.
//   link      - the movie has no file and one video is named for it (Radarr
//               needs a year in the name to read it): link it where it is
//   choose    - no file, several videos named for it: choose in Manual Import
//   unmatched - no file, and the video isn't named for the movie
//   copy      - the movie has a file: another copy (Find duplicates)
export function classifyMovieEntry(entry) {
  const m = entry.item;
  const has = !!(m.hasFile || m.movieFile);
  const named = entry.files.filter((f) => fileIsMovie(f.name, m));
  return entry.files.map((f) => {
    if (has) return { file: f, kind: 'copy' };
    if (named.length === 1 && named[0] === f) return { file: f, kind: 'link' };
    if (named.includes(f)) return { file: f, kind: 'choose' };
    return { file: f, kind: 'unmatched' };
  });
}

// Imports episode files where they are (inside the show's folder Sonarr
// records them in place: nothing is moved or renamed). answers: Sonarr's
// manual-import answers. Returns the paths now tracked.
export async function importEpisodeFiles(arr, entry, answers, { wait = 1000 } = {}) {
  const ok = new Set();
  if (!answers.length) return ok;
  try {
    const cmd = await arr.post('command', buildImportCommand('series', answers.map((a) => ({ ...a, series: { id: entry.item.id } })), { importMode: 'auto' }));
    await waitForCommand(arr, cmd, { wait, timeoutMs: 300000 });
  } catch { /* checked below */ }
  const now = new Set(list(await arr.get(`episodefile?seriesId=${encodeURIComponent(entry.item.id)}`).catch(() => [])).map((f) => trackedPath(entry.item, f)));
  for (const a of answers) if (now.has(pathKey(a.path))) ok.add(a.path);
  return ok;
}

// Links each movie to the video named for it, where it is. picks: [{ entry, file }].
export async function linkMovies(arr, picks, { wait = 1000 } = {}) {
  if (!picks.length) return new Set();
  const defs = await arr.get('qualitydefinition').catch(() => []);
  return linkMovieFiles(arr, picks.map(({ entry, file }) => ({ movieId: entry.item.id, path: file.path, folderName: nameOf(entry.item.path), quality: movieQualityFor(file.name, defs), language: entry.item.originalLanguage })), { wait });
}

export const UNTRACKED_CSV_HEADERS = ['Title', 'Folder', 'File', 'Episodes', 'Status'];
